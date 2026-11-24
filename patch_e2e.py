import os, glob

patched = False
for file in glob.glob('.github/workflows/*.yml'):
    with open(file, 'r') as f:
        content = f.read()
    
    # Inject binaryen installation right before the build command
    if 'npm run build' in content and 'binaryen' not in content:
        content = content.replace('npm run build', 'sudo apt-get update && sudo apt-get install -y binaryen && npm run build')
        with open(file, 'w') as f:
            f.write(content)
        print(f"[+] Patched {file} successfully.")
        patched = True

if not patched:
    print("[-] No matching build steps found in workflows.")
