const { exec } = require('child_process');
const fs = require('fs');
const http = require('http');

class BotMonitor {
  constructor() {
    this.checkInterval = 5 * 60 * 1000; // 5 minutos
    this.restartAttempts = 0;
    this.maxRestartAttempts = 3;
    this.logFile = 'monitor.log';
  }

  log(message) {
    const timestamp = new Date().toLocaleString();
    const logMessage = `[${timestamp}] ${message}\n`;
    console.log(logMessage.trim());
    
    // Guardar en archivo
    fs.appendFileSync(this.logFile, logMessage, 'utf8');
  }

  checkHealth() {
    return new Promise((resolve) => {
      const options = {
        hostname: 'localhost',
        port: process.env.PORT || 3000,
        path: '/api/health',
        method: 'GET',
        timeout: 10000
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const jsonData = JSON.parse(data);
            if (res.statusCode === 200 && jsonData.status === 'OK') {
              this.log(`✅ Bot saludable: ${jsonData.message}`);
              this.restartAttempts = 0; // Resetear intentos si está bien
              resolve(true);
            } else {
              this.log(`⚠️ Bot respondió con estado ${res.statusCode}: ${data}`);
              resolve(false);
            }
          } catch (error) {
            this.log(`❌ Error parseando respuesta: ${error.message}`);
            resolve(false);
          }
        });
      });

      req.on('error', (error) => {
        this.log(`❌ Error de conexión: ${error.message}`);
        resolve(false);
      });

      req.on('timeout', () => {
        this.log('⏰ Timeout al verificar salud del bot');
        req.destroy();
        resolve(false);
      });

      req.end();
    });
  }

  restartBot() {
    return new Promise((resolve) => {
      this.log(`🔄 Intentando reinicio (intento ${this.restartAttempts + 1}/${this.maxRestartAttempts})`);
      
      exec('npm run pm2-restart', (error, stdout, stderr) => {
        if (error) {
          this.log(`❌ Error al reiniciar: ${error.message}`);
          if (stderr) this.log(`STDERR: ${stderr}`);
          resolve(false);
        } else {
          this.log(`✅ Reinicio exitoso: ${stdout}`);
          this.restartAttempts++;
          resolve(true);
        }
      });
    });
  }

  async monitorLoop() {
    this.log('👀 Iniciando monitor de VPN Bot');
    
    // Verificar cada X minutos
    setInterval(async () => {
      this.log('🔍 Verificando estado del bot...');
      
      const isHealthy = await this.checkHealth();
      
      if (!isHealthy && this.restartAttempts < this.maxRestartAttempts) {
        this.log('⚠️ Bot no saludable, intentando reiniciar...');
        await this.restartBot();
        
        // Esperar 30 segundos después del reinicio
        setTimeout(async () => {
          const stillHealthy = await this.checkHealth();
          if (!stillHealthy) {
            this.log('❌ Bot sigue sin responder después del reinicio');
          } else {
            this.log('✅ Bot recuperado después del reinicio');
          }
        }, 30000);
      } else if (!isHealthy) {
        this.log(`🚨 Máximo de reinicios alcanzado (${this.maxRestartAttempts}). Necesita intervención manual.`);
      }
    }, this.checkInterval);
  }

  start() {
    // Verificar inmediatamente
    setTimeout(() => this.checkHealth(), 5000);
    
    // Iniciar loop de monitoreo
    this.monitorLoop();
    
    // También verificar cada hora de forma más exhaustiva
    setInterval(() => {
      this.log('📊 Reporte de estado - Verificando recursos...');
      this.checkSystemResources();
    }, 60 * 60 * 1000); // Cada hora
  }

  checkSystemResources() {
    const memoryUsage = process.memoryUsage();
    const uptime = process.uptime();
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    
    this.log(`📊 Estado del sistema - Online: ${hours}h ${minutes}m`);
    this.log(`   RAM usada: ${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`);
    this.log(`   RAM total: ${Math.round(memoryUsage.heapTotal / 1024 / 1024)}MB`);
    this.log(`   RSS: ${Math.round(memoryUsage.rss / 1024 / 1024)}MB`);
  }
}

// Iniciar monitor si se ejecuta directamente
if (require.main === module) {
  const monitor = new BotMonitor();
  monitor.start();
}

module.exports = BotMonitor;
