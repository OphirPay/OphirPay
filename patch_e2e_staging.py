import os, glob

patched = False
for file in glob.glob('.github/workflows/*.yml'):
    with open(file, 'r') as f:
        content = f.read()
    
    if 'npm run build' in content and 'binaryen' not in content:
        content = content.replace('npm run build', 'sudo apt-get update && sudo apt-get install -y binaryen && npm run build')
        with open(file, 'w') as f:
            f.write(content)
        print(f"[+] Patched {file} successfully.")
        patched = True
