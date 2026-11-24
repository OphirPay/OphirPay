import re

with open("src/components/WalletButton.tsx", "r") as f:
    content = f.read()

import_stmt = 'import { PaymentRequestModal } from "@/components/payments/PaymentRequestModal";\n'
if import_stmt not in content:
    content = content.replace('import { WalletSelector }', import_stmt + 'import { WalletSelector }')

state_stmt = '  const [showQrModal, setShowQrModal] = useState(false);\n'
if 'showQrModal' not in content:
    content = content.replace('const [showSelector, setShowSelector] = useState(false);', 'const [showSelector, setShowSelector] = useState(false);\n' + state_stmt)

btn_code = """          <button
            onClick={(e) => { e.stopPropagation(); setShowQrModal(true); }}
            className="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white ml-2 transition-colors"
            title="Show Receive QR"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 6.75h.75v.75h-.75v-.75zM6.75 16.5h.75v.75h-.75v-.75zM16.5 6.75h.75v.75h-.75v-.75zM13.5 13.5h.75v.75h-.75v-.75zM13.5 19.5h.75v.75h-.75v-.75zM19.5 13.5h.75v.75h-.75v-.75zM19.5 19.5h.75v.75h-.75v-.75zM16.5 16.5h.75v.75h-.75v-.75z" />
            </svg>
          </button>"""

if 'Show Receive QR' not in content:
    content = content.replace('{shortenAddress(wallet.publicKey)}\n          </span>', '{shortenAddress(wallet.publicKey)}\n          </span>\n' + btn_code)

modal_code = """      <PaymentRequestModal
        open={showQrModal}
        onClose={() => setShowQrModal(false)}
        request={wallet?.publicKey ? { destination: wallet.publicKey, description: "My Wallet Address" } : null}
      />"""

if 'PaymentRequestModal' not in content:
    # Try multiple possible injection points before the final closing tags
    if '</Modal>\n    </div>' in content:
        content = content.replace('</Modal>\n    </div>', '</Modal>\n' + modal_code + '\n    </div>')
    elif '</Modal>\n      </div>' in content:
        content = content.replace('</Modal>\n      </div>', '</Modal>\n' + modal_code + '\n      </div>')
    else:
        # Fallback to appending before the last </div>
        content = content[:content.rfind('</div>')] + modal_code + '\n    </div>\n'

with open("src/components/WalletButton.tsx", "w") as f:
    f.write(content)
print("[+] WalletButton.tsx patched successfully.")
