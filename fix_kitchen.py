import re

path = r"j:\wpf project\PYTHON PROJECTS\qr_menu_system\templates\Kitchen.html"

with open(path, 'r', encoding='utf-8', errors='replace') as f:
    content = f.read()

PING_MARKER = '    // \u2500\u2500 AUDIO PING \u2500'
TIME_MARKER = '    // \u2500\u2500 TIME ELAPSED \u2500'

ping_start = content.find(PING_MARKER)
time_start = content.find(TIME_MARKER)

print(f"ping_start={ping_start}, time_start={time_start}")

if ping_start < 0 or time_start < 0:
    print("ERROR: markers not found")
    exit(1)

good_block = '    // \u2500\u2500 AUDIO PING \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n    function ping() {\n      if (!soundEnabled || !audioCtx) return;\n      try {\n        const osc = audioCtx.createOscillator();\n        const gain = audioCtx.createGain();\n        osc.connect(gain); gain.connect(audioCtx.destination);\n        osc.frequency.setValueAtTime(880, audioCtx.currentTime);\n        osc.frequency.exponentialRampToValueAtTime(440, audioCtx.currentTime + 0.1);\n        osc.type = \'sine\';\n        gain.gain.setValueAtTime(0, audioCtx.currentTime);\n        gain.gain.linearRampToValueAtTime(0.5, audioCtx.currentTime + 0.05);\n        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);\n        osc.start(); osc.stop(audioCtx.currentTime + 0.5);\n      } catch (e) { }\n    }\n\n    // \u2500\u2500 TOAST \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n    function showToast(msg, isError = false) {\n      const wrap = document.getElementById(\'toastWrap\');\n      const el = document.createElement(\'div\');\n      el.className = \'toast\';\n      el.innerHTML = \'<strong>\' + (isError ? \'\u26a0\ufe0f \' : \'\u2713 \') + msg + \'</strong>\';\n      wrap.appendChild(el);\n      setTimeout(() => {\n        el.style.animation = \'toastOut 0.3s ease forwards\';\n        setTimeout(() => el.remove(), 300);\n      }, 3500);\n    }\n\n    '

new_content = content[:ping_start] + good_block + content[time_start:]

with open(path, 'w', encoding='utf-8', newline='') as f:
    f.write(new_content)

print(f"Done. New length: {len(new_content)}")

# Verify
with open(path, 'r', encoding='utf-8') as f:
    verify = f.read()
p = verify.find('// \u2500\u2500 AUDIO PING')
t = verify.find('// \u2500\u2500 TIME ELAPSED')
print("VERIFIED BLOCK:")
print(verify[p:t])
