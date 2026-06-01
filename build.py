#!/usr/bin/env python3

import os, time, ast, re
import json, glob, tarfile, requests
from io import BytesIO
from zipfile import ZipFile
from os import remove as rm, system, path, makedirs
from shutil import copyfile as cp, copytree, rmtree

def run(cmd):
    if system(cmd) != 0:
        raise Exception(f"Command failed: {cmd}")

def readfile(fn):
    with open(fn, 'r', encoding='utf-8') as f:
        return f.read()

def gen_translations(src, dst):
    result = {}
    for fn in glob.glob('*.json', root_dir=src):
        lang = fn.replace('.json', '')
        result[lang] = json.loads(readfile(src + fn))
    with open(dst, 'w', encoding='utf-8') as f:
        json.dump(result, f, separators=(',',':'), ensure_ascii=False, sort_keys=True)

def gen_examples(src, dst):
    def walk(d):
        items = []
        for name in sorted(os.listdir(d)):
            full = os.path.join(d, name)
            if os.path.isdir(full):
                items.append({"name": name, "children": walk(full)})
            elif name.endswith('.py'):
                items.append({"name": name, "code": readfile(full)})
        return items
    with open(dst, 'w', encoding='utf-8') as f:
        json.dump(walk(src), f, separators=(',',':'), ensure_ascii=False)

def gen_changelog(src, dst):
    with open(src, encoding='utf-8') as f:
        content = f.read()
    with open(dst, 'w', encoding='utf-8') as f:
        json.dump({"content": content}, f, separators=(',',':'), ensure_ascii=False)

def gen_stubs(src, dst):
    # Parse esp-vision .pyi stubs into completion data for the editor.
    # Docs use Sphinx-style "#:" comments, so they are collected line-by-line
    # and attached to the def/class/constant on the next code line.
    def doc_map(lines):
        docs, buf = {}, []
        for i, raw in enumerate(lines):
            s = raw.strip()
            if s.startswith('#:'):
                buf.append(s[2:].strip())
            elif s == '':
                buf = []
            elif s.startswith('#'):
                buf = []
            else:
                if buf:
                    docs[i + 1] = ' '.join(x for x in buf if x).strip()
                buf = []
        return docs

    def signature(lines, node, drop_self=False):
        seg = lines[node.lineno - 1: node.end_lineno]
        text = re.sub(r'\s+', ' ', ' '.join(p.strip() for p in seg)).strip()
        if text.endswith('...'):
            text = text[:-3].rstrip()
        if text.endswith(':'):
            text = text[:-1].rstrip()
        if text.startswith('def '):
            text = text[4:]
        if drop_self:
            text = re.sub(r'\(\s*self\b\s*,?\s*', '(', text, count=1)
        text = re.sub(r',\s*\)', ')', text)
        return text

    def option(label, otype, detail, info):
        opt = {'label': label, 'type': otype}
        if detail:
            opt['detail'] = detail
        if info:
            opt['info'] = info
        return opt

    modules, classes, ctors, ctor_sigs = {}, {}, {}, {}
    for fn in sorted(glob.glob('*.pyi', root_dir=src)):
        modname = fn[:-4]
        text = readfile(os.path.join(src, fn))
        lines = text.splitlines()
        docs = doc_map(lines)
        members = []
        for node in ast.parse(text).body:
            if isinstance(node, ast.FunctionDef):
                members.append(option(node.name, 'function', signature(lines, node), docs.get(node.lineno)))
            elif isinstance(node, ast.ClassDef):
                base_names = [b.id for b in node.bases if isinstance(b, ast.Name)]
                if 'TypedDict' in base_names or 'Protocol' in base_names:
                    continue
                cname = node.name
                ctor_sig = cname + '(...)'
                method_opts = []
                for sub in node.body:
                    if not isinstance(sub, ast.FunctionDef):
                        continue
                    if sub.name == '__init__':
                        ctor_sig = re.sub(r'^__init__', cname, signature(lines, sub, drop_self=True))
                    if sub.name.startswith('__'):
                        continue
                    method_opts.append(option(sub.name, 'method', signature(lines, sub, drop_self=True), docs.get(sub.lineno)))
                classes[cname] = method_opts
                ctor_sigs[cname] = ctor_sig
                ctors[modname + '.' + cname] = cname
                members.append(option(cname, 'class', ctor_sig, docs.get(node.lineno)))
            elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name) and node.value is None:
                raw = lines[node.lineno - 1].strip()
                detail = raw.split(':', 1)[1].strip() if ':' in raw else ''
                members.append(option(node.target.id, 'constant', detail, docs.get(node.lineno)))
            elif isinstance(node, ast.Assign) and len(node.targets) == 1 \
                    and isinstance(node.targets[0], ast.Name) and isinstance(node.value, ast.Name) \
                    and node.value.id in classes:
                name, target = node.targets[0].id, node.value.id
                ctors[modname + '.' + name] = target
                members.append(option(name, 'class', ctor_sigs.get(target, target + '(...)'),
                                      docs.get(node.lineno) or ('Alias of ' + target)))
        modules[modname] = {'members': members}

    with open(dst, 'w', encoding='utf-8') as f:
        json.dump({'modules': modules, 'classes': classes, 'ctors': ctors},
                  f, separators=(',', ':'), ensure_ascii=False)

def gen_manifest(src, dst):
    pkg = json.loads(readfile('package.json'))
    result = json.loads(readfile(src))
    result['version'] = pkg['version']
    with open(dst, 'w', encoding='utf-8') as f:
        json.dump(result, f, separators=(',',':'), ensure_ascii=False)

def gen_tar(src, dst):
    def reset_tarinfo(tarinfo):
        tarinfo.uid = 0
        tarinfo.gid = 0
        tarinfo.uname = ""
        tarinfo.gname = ""
        tarinfo.mtime = 0
        return tarinfo
    with tarfile.open(dst, "w:gz") as tar:
        for item in os.listdir(src):
            item_path = os.path.join(src, item)
            tar.add(item_path, arcname=item, filter=reset_tarinfo)

def download_and_extract(url, subfolder, dest):
    response = requests.get(url)
    response.raise_for_status()
    with ZipFile(BytesIO(response.content)) as zip_file:
        # Filter for files within the specific subfolder
        subfolder_files = [f for f in zip_file.namelist() if f.startswith(subfolder)]

        # Extract each file, adjusting the path
        for file_path in subfolder_files:
            # Extract only if it's a file (not an empty directory)
            if not file_path.endswith('/'):
                new_path = file_path[len(subfolder):]  # Remove the subfolder part of the path
                with zip_file.open(file_path) as source:
                    data = source.read()
                target_path = f'{dest}/{new_path}'  # Define new extraction path
                # Create target directory if not exists
                os.makedirs(os.path.dirname(target_path), exist_ok=True)
                with open(target_path, 'wb') as target_file:
                    target_file.write(data)

def combine(dst):
    # Insert CSS and JS into HTML
    combined = readfile(dst).replace(
        '<link rel="stylesheet" href="./app.css">', '<style>\n' + readfile('build/app.css') + '\n</style>'
    ).replace(
        '<link rel="stylesheet" href="./viper_lib.css">', '<style>\n' + readfile('build/viper_lib.css') + '\n</style>'
    ).replace(
        '<script src="./app.js"></script>', '<script>\n' + readfile('build/app.js') + '\n</script>'
    ).replace(
        '<script src="./viper_lib.js"></script>', '<script>\n' + readfile('build/viper_lib.js') + '\n</script>'
    )

    # Write the combined content
    with open(dst, 'w', encoding='utf-8') as f:
        f.write(combined)

if __name__ == "__main__":
    # Prepare
    rmtree("build", ignore_errors=True)
    makedirs("build/assets")
    cp("./src/webrepl_content.js", "./build/webrepl_content.js")
    copytree("./assets", "./build/assets", dirs_exist_ok=True)
    gen_translations("./src/lang/", "build/translations.json")
    gen_examples("./examples", "build/examples.json")
    gen_stubs("./stubs", "build/stubs.json")
    gen_changelog("./CHANGELOG.md", "build/changelog.json")
    gen_manifest("./src/manifest.json", "build/manifest.json")

    download_and_extract("https://github.com/dflook/python-minifier/archive/refs/tags/3.1.1.zip",
                         "python-minifier-3.1.1/src/python_minifier/",
                         "src/tools_vfs/lib/python_minifier")
    gen_tar("src/tools_vfs", "build/assets/tools_vfs.tar.gz")
    gen_tar("src/vm_vfs", "build/assets/vm_vfs.tar.gz")

    # Build
    if not path.isdir("node_modules"):
        run("npm install")
    run("npx eslint")
    run("npm run build")

    # Combine everything
    combine("build/index.html")
    combine("build/bridge.html")
    combine("build/benchmark.html")

    # Cleanup
    #run("rm build/translations.json")
    run("rm build/app.css   build/viper_lib.css")
    run("rm build/app.js    build/viper_lib.js")

    # Add assets from packages
    cp("node_modules/@micropython/micropython-webassembly-pyscript/micropython.wasm", "./build/assets/micropython.wasm")
    cp("node_modules/@micropython/micropython-webassembly-pyscript/micropython.mjs", "./build/micropython.mjs")
    cp("node_modules/@pybricks/mpy-cross-v6/build/mpy-cross-v6.wasm", "./build/assets/mpy-cross-v6.wasm")
    cp("node_modules/@astral-sh/ruff-wasm-web/ruff_wasm_bg.wasm", "./build/assets/ruff_wasm_bg.wasm")

    print()
    print("Build complete.")
