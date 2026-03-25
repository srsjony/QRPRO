import sys

path = r"j:\wpf project\PYTHON PROJECTS\qr_menu_system\templates\Kitchen.html"

with open(path, 'r', encoding='utf-8', errors='replace') as f:
    lines = f.readlines()

print(f"Total lines: {len(lines)}")

# Find the main script block (after socket.io, starts with bare <script>)
main_script_start = None
main_script_end = None

for i, line in enumerate(lines):
    stripped = line.strip()
    if stripped == '<script>' and main_script_start is None:
        # Make sure it's the large main script (not inline attr scripts)
        main_script_start = i
    if stripped == '</script>' and main_script_start is not None and main_script_end is None:
        # The first </script> after the open = end of main script
        if i - main_script_start > 10:  # skip tiny scripts
            main_script_end = i

print(f"Main script: lines {main_script_start+1} to {main_script_end+1}")

clean_js = """  <script>
    window.alert = function(msg) {
      if (typeof showToast === 'function') showToast(msg, true);
      else console.log('ALERT:', msg);
    };
    window.confirm = function(msg) { return true; };

    const RESTAURANT = '{{username}}';
    const CSRF_TOKEN = document.querySelector('meta[name="csrf-token"]').content;
    let orders = [];
    let knownIds = new Set();
    let currentFilter = 'active';

    // Clock
    function tickClock() {
      const now = new Date();
      document.getElementById('clock').textContent = now.toTimeString().slice(0, 8);
    }
    tickClock();
    setInterval(tickClock, 1000);

    let audioCtx = null;
    let soundEnabled = true;

    function initAudio() {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      soundEnabled = true;
      const btn = document.getElementById('btnSound');
      btn.textContent = '&#128266; Sound On';
      btn.classList.add('enabled');
    }

    function toggleSound() {
      if (!audioCtx) { initAudio(); return; }
      soundEnabled = !soundEnabled;
      const btn = document.getElementById('btnSound');
      if (soundEnabled) { btn.textContent = '&#128266; Sound On'; btn.classList.add('enabled'); }
      else { btn.textContent = '&#128263; Sound Off'; btn.classList.remove('enabled'); }
    }

    document.addEventListener('click', function autoInit() {
      initAudio();
      document.removeEventListener('click', autoInit);
    }, { once: true });

    function ping() {
      if (!soundEnabled || !audioCtx) return;
      try {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.frequency.setValueAtTime(880, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(440, audioCtx.currentTime + 0.1);
        osc.type = 'sine';
        gain.gain.setValueAtTime(0, audioCtx.currentTime);
        gain.gain.linearRampToValueAtTime(0.5, audioCtx.currentTime + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);
        osc.start(); osc.stop(audioCtx.currentTime + 0.5);
      } catch (e) {}
    }

    function showToast(msg, isError) {
      isError = isError || false;
      const wrap = document.getElementById('toastWrap');
      const el = document.createElement('div');
      el.className = 'toast';
      el.innerHTML = '<strong>' + (isError ? '&#9888; ' : '&#10003; ') + msg + '</strong>';
      wrap.appendChild(el);
      setTimeout(function() {
        el.style.animation = 'toastOut 0.3s ease forwards';
        setTimeout(function() { el.remove(); }, 300);
      }, 3500);
    }

    function elapsed(created_at) {
      const created = new Date(created_at.replace(' ', 'T') + 'Z');
      const diff = Math.floor((Date.now() - created.getTime()) / 1000);
      if (diff < 60) return diff + 's';
      if (diff < 3600) return Math.floor(diff / 60) + 'm ' + (diff % 60) + 's';
      return Math.floor(diff / 3600) + 'h ' + Math.floor((diff % 3600) / 60) + 'm';
    }

    function isUrgent(created_at) {
      const created = new Date(created_at.replace(' ', 'T') + 'Z');
      return (Date.now() - created.getTime()) > 10 * 60 * 1000;
    }

    function setFilter(f, btn) {
      currentFilter = f;
      document.querySelectorAll('.filter-btn').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      renderOrders();
    }

    async function setStatus(id, status) {
      if (status === 'cancelled') {
        const card = document.getElementById('card-' + id);
        if (card) { card.style.opacity = '0'; card.style.transform = 'scale(0.95)'; setTimeout(function() { card.remove(); }, 300); }
      }
      try {
        await fetch('/update_order/' + id, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRFToken': CSRF_TOKEN },
          body: JSON.stringify({ status: status })
        });
      } catch (e) {}
      fetchOrders();
    }

    function renderOrders() {
      const grid = document.getElementById('ordersGrid');
      const title = document.getElementById('gridTitle');
      let filtered = orders.filter(function(o) {
        if (currentFilter === 'active') return o.status === 'pending' || o.status === 'preparing';
        return true;
      });
      if (filtered.length === 0) {
        title.textContent = currentFilter === 'active' ? 'LIVE ORDERS' : 'ALL ORDERS';
        grid.innerHTML = '<div class="empty-kds"><div class="e-icon">&#127857;</div><h3>Kitchen Clear</h3><p>' + (currentFilter === 'active' ? 'No active orders right now.' : 'No orders to display.') + '</p></div>';
        return;
      }
      title.textContent = (currentFilter === 'active' ? 'LIVE ORDERS' : 'ALL ORDERS') + ' \u2014 ' + filtered.length;
      // Remove stale cards
      grid.querySelectorAll('.order-card').forEach(function(card) {
        const id = parseInt(card.id.replace('card-', ''));
        if (!filtered.find(function(o) { return o.id === id; })) {
          card.style.opacity = '0';
          setTimeout(function() { card.remove(); }, 300);
        }
      });
      filtered.forEach(function(o) {
        const isNew = !knownIds.has ? false : false;
        const items = o.items.map(function(it) {
          return '<div class="order-item"><span class="item-name">' + it.name + '</span><span class="item-qty">x' + it.qty + '</span></div>';
        }).join('');
        const notes = o.notes ? '<div class="order-notes">&#128221; ' + o.notes + '</div>' : '';
        const el_elapsed = elapsed(o.created_at);
        const urgent = isUrgent(o.created_at);
        const actions = o.status === 'pending'
          ? '<button class="action-btn btn-preparing" onclick="setStatus(' + o.id + ',\'preparing\')">Preparing</button><button class="action-btn btn-done" onclick="setStatus(' + o.id + ',\'done\')">Done</button>'
          : o.status === 'preparing'
          ? '<button class="action-btn btn-done" onclick="setStatus(' + o.id + ',\'done\')">Mark Done</button><button class="action-btn btn-undo" onclick="setStatus(' + o.id + ',\'pending\')">Undo</button>'
          : '<button class="action-btn btn-undo" onclick="setStatus(' + o.id + ',\'pending\')">Re-open</button>';
        const html = '<div class="card-top"><div class="table-badge"><span>Table</span>' + o.table + '</div><div class="card-meta"><span class="status-pill ' + o.status + '">' + o.status + '</span><span class="elapsed' + (urgent ? ' urgent' : '') + '">' + el_elapsed + '</span></div></div><div class="card-items">' + items + notes + '</div><div class="card-footer"><span class="order-total">Rs.' + parseFloat(o.total).toFixed(2) + '</span><div class="action-row">' + actions + '</div></div>';
        let card = document.getElementById('card-' + o.id);
        if (card) {
          card.className = 'order-card status-' + o.status;
          card.innerHTML = html;
        } else {
          card = document.createElement('div');
          card.id = 'card-' + o.id;
          card.className = 'order-card status-' + o.status + ' new-flash';
          card.innerHTML = html;
          grid.appendChild(card);
        }
      });
    }

    async function fetchOrders() {
      try {
        const res = await fetch('/kitchen_orders/' + RESTAURANT);
        const data = await res.json();
        const newOrders = data.orders || [];
        const newIds = new Set(newOrders.map(function(o) { return o.id; }));
        newOrders.forEach(function(o) {
          if (!knownIds.has(o.id) && (o.status === 'pending' || o.status === 'preparing')) {
            ping();
            showToast('New order \u2014 Table ' + o.table, false);
          }
        });
        orders = newOrders;
        knownIds = newIds;
        updateStats();
        renderOrders();
      } catch (e) {}
    }

    function updateStats() {
      document.getElementById('statPending').textContent = orders.filter(function(o) { return o.status === 'pending'; }).length;
      document.getElementById('statPrep').textContent = orders.filter(function(o) { return o.status === 'preparing'; }).length;
      document.getElementById('statDone').textContent = orders.filter(function(o) { return o.status === 'done'; }).length;
      document.getElementById('statTotal').textContent = orders.length;
    }

    const socket = io({ transports: ['websocket', 'polling'] });
    socket.on('connect', function() {
      socket.emit('join', { room: RESTAURANT });
      document.getElementById('connDot').classList.remove('offline');
      document.getElementById('connLabel').textContent = 'Live';
    });
    socket.on('disconnect', function() {
      document.getElementById('connDot').classList.add('offline');
      document.getElementById('connLabel').textContent = 'Reconnecting\u2026';
    });
    socket.on('new_order', function() { fetchOrders(); });
    socket.on('order_updated', function() { fetchOrders(); });
    socket.on('table_settled', function() { fetchOrders(); });

    fetchOrders();
    setInterval(fetchOrders, 8000);
  </script>
"""

before = lines[:main_script_start]
after = lines[main_script_end + 1:]

new_lines = before + [clean_js] + after

with open(path, 'w', encoding='utf-8', newline='') as f:
    f.writelines(new_lines)

print(f"Done. Total lines: {len(new_lines)}")
print("SUCCESS: Kitchen.html fixed!")
