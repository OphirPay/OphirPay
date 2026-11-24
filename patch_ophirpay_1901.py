with open("src/app/address-book/page.tsx", "r") as f:
    page_text = f.read()

old_edit = '                <Button variant="outline" size="sm" onClick={() => openEdit(entry)}>'
new_edit = '                <Button variant="outline" size="sm" onClick={() => openEdit(entry)} className="min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0">'
page_text = page_text.replace(old_edit, new_edit)

old_delete = """                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => setDeleting(entry)}
                >"""
new_delete = """                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => setDeleting(entry)}
                  className="min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0"
                >"""
page_text = page_text.replace(old_delete, new_delete)

old_addr = '                  <span className="text-sm font-mono text-gray-600 dark:text-gray-300 truncate">'
new_addr = '                  <span className="text-sm font-mono text-gray-600 dark:text-gray-300 truncate max-w-[120px] sm:max-w-none">'
page_text = page_text.replace(old_addr, new_addr)

with open("src/app/address-book/page.tsx", "w") as f:
    f.write(page_text)
print("[+] page.tsx patched")

with open("src/components/batches/AddressBookMultiSelect.tsx", "r") as f:
    multi_text = f.read()

old_multi_addr = '                  <span className="block text-xs font-mono text-gray-500 dark:text-gray-400 truncate">'
new_multi_addr = '                  <span className="block text-xs font-mono text-gray-500 dark:text-gray-400 truncate max-w-[120px] sm:max-w-none">'
multi_text = multi_text.replace(old_multi_addr, new_multi_addr)

old_minw = 'className={`flex items-center gap-3 px-3 py-2.5 min-w-[280px]'
new_minw = 'className={`flex items-center gap-3 px-3 py-2.5 min-w-0 sm:min-w-[280px]'
multi_text = multi_text.replace(old_minw, new_minw)

with open("src/components/batches/AddressBookMultiSelect.tsx", "w") as f:
    f.write(multi_text)
print("[+] AddressBookMultiSelect.tsx patched")
