import sys

with open('templates/captain.html', 'r', encoding='utf-8') as f:
    cap = f.read()

with open('extracted_printer.js', 'r', encoding='utf-8') as f:
    printer_module = f.read()

lines = cap.split('\n')
start = -1
end = -1
for i, l in enumerate(lines):
    if '// --- BLUETOOTH PRINTING' in l:
        start = i
    if start != -1 and '}' in l and i > start + 5:
        if '}' == l.strip():
            end = i
            # Look ahead
            if i + 1 < len(lines) and 'Init PWA protections' in lines[i+1]:
                break
            if i + 2 < len(lines) and 'Init PWA protections' in lines[i+2]:
                end = i + 1
                break

new_print_bill_logic = """
    // Ensure LOGO is defined
    const LOGO = ""; 

    // Fallback askPayment
    let currentTableToPrint = null;
    function askPayment(tableNo) {
      currentTableToPrint = tableNo;
      printBill(tableNo);
    }

    async function printBill(tableNo) {
      if (!tableNo && !currentTable) return;
      let targetTable = tableNo || currentTable;
      try {
        const res = await fetch('/api/print_bill', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': CSRF_TOKEN },
          body: JSON.stringify({ 
            username: username, 
            table: targetTable,
            pay_method: 'cash' 
          })
        });
        
        const data = await res.json();
        if (!res.ok) {
          showToast(data.error || 'Print failed', true); return;
        }

        if (typeof serialPort !== 'undefined' && serialPort) {
          const printed = await printViaSerial(data.bill_text);
          if (printed) { showToast('Printed successfully!'); return; }
        } else if (typeof writeCharacteristic !== 'undefined' && writeCharacteristic && printerConnected) {
          const printed = await printViaBluetooth(data.bill_text);
          if (printed) { showToast('Printed successfully!'); return; }
        } else if (!window.ReactNativeWebView) {
          showToast('Printer not connected! Please click COM or BT above.', true);
          return;
        }

        if (window.ReactNativeWebView) {
          let base64Bytes = '';
          try {
             const rawBytes = await compileReceiptBytes(data.bill_text);
             let binary = '';
             for (let i = 0; i < rawBytes.byteLength; i++) { binary += String.fromCharCode(rawBytes[i]); }
             base64Bytes = window.btoa(binary);
          } catch(e) { console.error(e); }

          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'PRINT_BILL',
            bill_text: data.bill_text,
            bill_no: data.bill_no,
            table: targetTable,
            total: data.total,
            raw_bytes_base64: base64Bytes
          }));
          showToast('Sent to printer...');
        }
      } catch (err) {
        showToast('Failed to prepare bill for printing.', true);
      }
    }"""

cap_script_start = '\\n'.join(lines[:start])
cap_script_end = '\\n'.join(lines[end+1:])

new_cap_script = cap_script_start + '\\n\\n' + printer_module + '\\n' + new_print_bill_logic + '\\n\\n' + cap_script_end

# FIX HTML HEADER
header_old = '''    <div class="header">
      <div class="header-title">Select Table</div>
      <button class="header-btn" onclick="captainLogout()" title="Logout" style="font-size: 18px;">🚪</button>
    </div>'''
header_new = '''    <div class="header" style="justify-content: flex-start; gap: 8px;">
      <div class="header-title" style="flex: 1; font-size: 16px;">Tables</div>
      <button class="cat-pill" id="btnConnectSerial" onclick="connectSerialPrinter()" style="border-color:#60a5fa; color:#60a5fa; padding:4px 8px; font-size:10px;" title="Connect USB/COM Printer">🔌 COM</button>
      <button class="cat-pill" id="btnConnectBT" onclick="connectBluetoothPrinter()" style="border-color:#818cf8; color:#818cf8; padding:4px 8px; font-size:10px;" title="Connect Bluetooth Printer">📶 BT</button>
      <button class="header-btn" onclick="captainLogout()" title="Logout" style="font-size: 18px; margin-left: auto;">🚪</button>
    </div>'''
new_cap_script = new_cap_script.replace(header_old, header_new)

# Fix floating printBtn
new_cap_script = new_cap_script.replace('onclick="printBill()"', 'onclick="printBill(currentTable)"')

with open('templates/captain.html', 'w', encoding='utf-8') as f:
    f.write(new_cap_script)

print('Updated captain.html!')
