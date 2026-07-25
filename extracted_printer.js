    // --- THERMAL PRINTER SUPPORT (Serial COM) ---
    let serialPort = null;
    let writer = null;
    let printerConnected = false;
    
    // Alternative: Bluetooth
    let bluetoothDevice = null;
    let writeCharacteristic = null;

    // Common thermal printer service UUIDs
    const PRINTER_SERVICES = [
      '00001800-0000-1000-8000-00805f9b34fb', // Generic SPP
      '0000fee0-0000-1000-8000-00805f9b34fb', // Many thermal printers
      '0000fff0-0000-1000-8000-00805f9b34fb', // Common printer service
      '0000fff0-0000-1000-8000-00805f9b34fb',
    ];

    const PRINTER_WRITE_CHARS = [
      '00002a00-0000-1000-8000-00805f9b34fb',
      '0000fee1-0000-1000-8000-00805f9b34fb',
      '0000fff1-0000-1000-8000-00805f9b34fb',
    ];

    // ESC/POS Commands
    const ESC = 0x1B;
    const GS = 0x1D;
    const LF = 0x0A;


    async function getImageData(url) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'Anonymous';
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          const MAX_WIDTH = 256; 
          let width = img.width;
          let height = img.height;
          if (width > MAX_WIDTH) {
            height = Math.floor(height * (MAX_WIDTH / width));
            width = MAX_WIDTH;
          }
          width = Math.floor(width / 8) * 8;
          canvas.width = width;
          canvas.height = height;
          ctx.fillStyle = 'white';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);
          resolve({
            data: ctx.getImageData(0, 0, width, height).data,
            width: width,
            height: height
          });
        };
        img.onerror = reject;
        img.src = url;
      });
    }

    async function getEscPosImage(url) {
      try {
        const { data, width, height } = await getImageData(url);
        const xL = (width / 8) % 256;
        const xH = Math.floor((width / 8) / 256);
        const yL = height % 256;
        const yH = Math.floor(height / 256);
        
        const bytes = [0x1D, 0x76, 0x30, 0x00, xL, xH, yL, yH];

        let darkBorderPixels = 0;
        let totalBorderPixels = 0;
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            if (x < 2 || x > width - 3 || y < 2 || y > height - 3) {
              const idx = (y * width + x) * 4;
              const r = data[idx], g = data[idx+1], b_val = data[idx+2];
              const brightness = r * 0.299 + g * 0.587 + b_val * 0.114;
              if (brightness < 128) darkBorderPixels++;
              totalBorderPixels++;
            }
          }
        }
        
        const shouldInvert = darkBorderPixels > (totalBorderPixels * 0.6);

        const gray = new Uint8Array(width * height);
        for (let i = 0; i < width * height; i++) {
          const idx = i * 4;
          const r = data[idx], g = data[idx+1], b_val = data[idx+2], a = data[idx+3];
          let brightness = 255;
          if (a > 128) {
            brightness = r * 0.299 + g * 0.587 + b_val * 0.114;
          }
          if (shouldInvert) {
            brightness = 255 - brightness;
          }
          gray[i] = brightness;
        }

        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const i = y * width + x;
            const oldPixel = gray[i];
            const newPixel = oldPixel < 128 ? 0 : 255;
            gray[i] = newPixel;
            const quantError = oldPixel - newPixel;
            
            if (x + 1 < width) gray[i + 1] = Math.min(255, Math.max(0, gray[i + 1] + quantError * 7 / 16));
            if (y + 1 < height) {
              if (x > 0) gray[i + width - 1] = Math.min(255, Math.max(0, gray[i + width - 1] + quantError * 3 / 16));
              gray[i + width] = Math.min(255, Math.max(0, gray[i + width] + quantError * 5 / 16));
              if (x + 1 < width) gray[i + width + 1] = Math.min(255, Math.max(0, gray[i + width + 1] + quantError * 1 / 16));
            }
          }
        }
        
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x += 8) {
            let byte = 0;
            for (let b = 0; b < 8; b++) {
              const val = gray[y * width + x + b];
              if (val === 0) {
                byte |= (1 << (7 - b));
              }
            }
            bytes.push(byte);
          }
        }
        return bytes;
      } catch (e) {
        console.error('Image processing failed', e);
        return [];
      }
    }
    function escposInit() {
      return [ESC, 0x40];
    }
    
    function escposAlignCenter() {
      return [ESC, 0x61, 1];
    }
    
    function escposAlignLeft() {
      return [ESC, 0x61, 0];
    }
    
    function escposBold(on) {
      return [ESC, 0x45, on ? 1 : 0];
    }
    
    function escposDoubleHeight(on) {
      return [GS, 0x21, on ? 0x01 : 0x00];
    }
    
    function escposCut() {
      return [GS, 0x56, 0];
    }
    
    function escposFeedLines(n) {
      return [ESC, 0x64, n];
    }
    
    function escposText(text) {
      const bytes = [];
      for (let i = 0; i < text.length; i++) {
        bytes.push(text.charCodeAt(i));
      }
      return bytes;
    }
    
    function escposNewLine() {
      return [LF];
    }

    async function connectPrinter() {
      const method = document.getElementById('printMethod')?.value || 'serial';
      
      if (method === 'bluetooth') {
        return await connectBluetoothPrinter();
      } else if (method === 'serial') {
        return await connectSerialPrinter();
      } else {
        showToast('Using browser print. Click Print to print.');
        return true;
      }
    }

    async function connectBluetoothPrinter() {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'CONNECT_BLUETOOTH' }));
        return true;
      }
      // Check if Web Bluetooth is available
      if (!navigator.bluetooth) {
        showToast('Bluetooth not supported. Use Chrome/Edge on desktop.', true);
        return false;
      }
      
      try {
        showToast('Searching for Bluetooth devices...');
        
        // Request any device (no filter) - user will select
        bluetoothDevice = await navigator.bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices: ['00001800-0000-1000-8000-00805f9b34fb', '0000fee0-0000-1000-8000-00805f9b34fb', '0000fff0-0000-1000-8000-00805f9b34fb']
        });
        
        console.log('Selected device:', bluetoothDevice.name);
        showToast('Connecting to ' + bluetoothDevice.name + '...');
        
        const server = await bluetoothDevice.gatt.connect();
        
        // Try to find write characteristic
        const services = await server.getPrimaryServices();
        
        for (const service of services) {
          console.log('Service:', service.uuid);
          try {
            const characteristics = await service.getCharacteristics();
            for (const char of characteristics) {
              console.log('  Char:', char.uuid, 'props:', char.properties);
              if (char.properties.write || char.properties.writeWithoutResponse) {
                writeCharacteristic = char;
                console.log('Found writable characteristic!');
                break;
              }
            }
            if (writeCharacteristic) break;
          } catch (e) {
            console.log('Error getting characteristics:', e);
          }
        }
        
        if (!writeCharacteristic) {
          // Try common write characteristic as fallback
          writeCharacteristic = await server.getPrimaryService('0000fff0-0000-1000-8000-00805f9b34fb')
            .then(s => s.getCharacteristic('0000fff1-0000-1000-8000-00805f9b34fb'))
            .catch(() => null);
        }
        
        if (!writeCharacteristic) {
          throw new Error('Could not find writable characteristic');
        }
        
        printerConnected = true;
        showToast('Printer connected: ' + bluetoothDevice.name);
        
        const btn = document.getElementById('btnConnectBT');
        if (btn) {
          btn.textContent = '🖨 ' + bluetoothDevice.name;
          btn.style.borderColor = '#22c55e';
          btn.style.color = '#22c55e';
        }
        
        bluetoothDevice.addEventListener('gattserverdisconnected', () => {
          printerConnected = false;
          showToast('Printer disconnected', true);
          if (btn) {
            btn.textContent = '📶 Bluetooth';
            btn.style.borderColor = '#818cf8';
            btn.style.color = '#818cf8';
          }
        });
        
        return true;
      } catch (error) {
        console.error('Bluetooth error:', error);
        if (error.name === 'NotFoundError') {
          showToast('No device selected', true);
        } else {
          showToast('Connection failed: ' + error.message, true);
        }
        return false;
      }
    }

        async function compileReceiptBytes(text) {
      let data = [...escposInit()];

      if (LOGO) {
        data = data.concat(escposAlignCenter());
        const imgBytes = await getEscPosImage('/static/uploads/' + LOGO);
        if (imgBytes.length > 0) {
          data = data.concat(imgBytes);
          data = data.concat(escposFeedLines(1));
        }
      }
      
      const lines = text.split('\n');
      for (const line of lines) {
        if (line.startsWith('**') && line.endsWith('**')) {
          data = data.concat(escposBold(true));
          data = data.concat(escposDoubleHeight(true));
          data = data.concat(escposAlignCenter());
          data = data.concat(escposText(line.replace(/\*\*/g, '')));
          data = data.concat(escposNewLine());
          data = data.concat(escposBold(false));
          data = data.concat(escposDoubleHeight(false));
        } else if (line.startsWith('===') || line.startsWith('---') || line === '') {
          data = data.concat(escposAlignCenter());
          data = data.concat(escposText(line));
          data = data.concat(escposNewLine());
        } else if (line.includes('TOTAL') || line.includes('Net Amount')) {
          data = data.concat(escposBold(true));
          data = data.concat(escposAlignLeft());
          data = data.concat(escposText(line));
          data = data.concat(escposNewLine());
          data = data.concat(escposBold(false));
        } else {
          data = data.concat(escposAlignLeft());
          data = data.concat(escposText(line));
          data = data.concat(escposNewLine());
        }
      }
      
      data = data.concat(escposFeedLines(3));
      data = data.concat(escposCut());
      return new Uint8Array(data);
    }

async function printViaBluetooth(text) {
      if (!printerConnected || !writeCharacteristic) {
        showToast('Printer not connected. Please click Connect first.', true);
        return false;
      }
      
      try {
        const buffer = await compileReceiptBytes(text);
        
        if (writeCharacteristic.properties.write) {
          await writeCharacteristic.writeValue(buffer);
        } else if (writeCharacteristic.properties.writeWithoutResponse) {
          await writeCharacteristic.writeValueWithoutResponse(buffer);
        }
        
        return true;
      } catch (error) {
        console.error('Print error:', error);
        showToast('Print failed: ' + error.message, true);
        printerConnected = false;
        return false;
      }
    }

    // --- SERIAL PORT PRINTING (COM ports) ---
    async function connectSerialPrinter(portName) {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'CONNECT_SERIAL' }));
        return true;
      }
      try {
        if (!navigator.serial) {
          throw new Error('Serial API not supported');
        }
        
        let port;
        if (portName) {
          // Connect to specific port
          port = await navigator.serial.requestPort({
            filters: [{ usbProductId: 0x0001, usbVendorId: 0x0403 }] // Common FTDI
          });
        } else {
          // Let user select
          port = await navigator.serial.requestPort();
        }
        
        await port.open({ baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'none' });
        
        serialPort = port;
        writer = port.writable.getWriter();
        printerConnected = true;
        
        const btn = document.getElementById('btnConnectSerial');
        if (btn) {
          btn.textContent = '🔌 COM Active';
          btn.style.borderColor = '#22c55e';
          btn.style.color = '#22c55e';
        }
        
        port.addEventListener('disconnect', () => {
          printerConnected = false;
          if (btn) {
            btn.textContent = '🔌 COM Port';
            btn.style.borderColor = '#60a5fa';
            btn.style.color = '#60a5fa';
          }
        });
        
        showToast('Serial printer connected!');
        return true;
      } catch (error) {
        console.error('Serial error:', error);
        showToast('Serial connection failed: ' + error.message, true);
        return false;
      }
    }

    async function printViaSerial(text) {
      if (typeof serialPort === 'undefined' || !serialPort || !writer) {
        showToast('Printer not connected. Please click Connect first.', true);
        return false;
      }
      
      try {
        const buffer = await compileReceiptBytes(text);
        await writer.write(buffer);
        
        return true;
      } catch (error) {
        console.error('Serial print error:', error);
        showToast('Print failed: ' + error.message, true);
        printerConnected = false;
        return false;
      }
    }
