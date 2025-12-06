const { createClient } = require('@supabase/supabase-js');
const fs = require('fs').promises;
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Error: Faltan variables de entorno SUPABASE_URL o SUPABASE_KEY/SUPABASE_ANON_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const db = {
  // ========== STORAGE (IMÁGENES) ==========
  async uploadImage(filePath, telegramId) {
    try {
      console.log(`📤 Subiendo imagen para usuario ${telegramId}: ${filePath}`);
      
      // Leer el archivo como buffer
      const fileBuffer = await fs.readFile(filePath);
      const fileName = `screenshot_${telegramId}_${Date.now()}.jpg`;
      
      console.log(`📁 Nombre del archivo en storage: ${fileName}`);
      
      // Subir a Supabase Storage
      const { data, error } = await supabase.storage
        .from('payments-screenshots')
        .upload(fileName, fileBuffer, {
          contentType: 'image/jpeg',
          cacheControl: '3600',
          upsert: false
        });

      if (error) {
        console.error('❌ Error subiendo imagen a Supabase Storage:', error);
        throw error;
      }

      console.log('✅ Imagen subida a storage. Obtener URL pública...');

      // Obtener URL pública
      const { data: { publicUrl } } = supabase.storage
        .from('payments-screenshots')
        .getPublicUrl(fileName);

      console.log(`✅ URL pública obtenida: ${publicUrl}`);
      return publicUrl;

    } catch (error) {
      console.error('❌ Error en uploadImage:', error);
      throw error;
    }
  },

  // ========== USUARIOS ==========
  async getUser(telegramId) {
    try {
      console.log(`🔍 Buscando usuario ${telegramId}...`);
      
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('telegram_id', telegramId)
        .single();
      
      if (error && error.code === 'PGRST116') {
        console.log(`📭 Usuario ${telegramId} no encontrado`);
        return null;
      }
      
      if (error) {
        console.error('❌ Error obteniendo usuario:', error.message);
        return null;
      }
      
      console.log(`✅ Usuario encontrado: ${data.first_name || data.username || telegramId}`);
      return data;
    } catch (error) {
      console.error('❌ Error en getUser:', error);
      return null;
    }
  },

  async saveUser(telegramId, userData) {
    try {
      console.log(`💾 Guardando usuario ${telegramId}...`);
      
      // Verificar si el usuario ya existe
      const existingUser = await this.getUser(telegramId);
      
      if (existingUser) {
        // Actualizar usuario existente
        console.log(`✏️ Actualizando usuario existente ${telegramId}`);
        
        const { data, error } = await supabase
          .from('users')
          .update({
            ...userData,
            updated_at: new Date().toISOString()
          })
          .eq('telegram_id', telegramId)
          .select()
          .single();
        
        if (error) {
          console.error('❌ Error actualizando usuario:', error);
          throw error;
        }
        
        console.log(`✅ Usuario actualizado: ${data.first_name || data.username || telegramId}`);
        return data;
      } else {
        // Crear nuevo usuario
        console.log(`🆕 Creando nuevo usuario ${telegramId}`);
        
        const { data, error } = await supabase
          .from('users')
          .insert([{
            telegram_id: telegramId,
            ...userData,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }])
          .select()
          .single();
        
        if (error) {
          console.error('❌ Error creando usuario:', error);
          throw error;
        }
        
        console.log(`✅ Usuario creado: ${data.first_name || data.username || telegramId}`);
        return data;
      }
    } catch (error) {
      console.error('❌ Error guardando usuario:', error);
      throw error;
    }
  },

  async acceptTerms(telegramId) {
    console.log(`✅ Aceptando términos para usuario ${telegramId}`);
    return await this.saveUser(telegramId, {
      accepted_terms: true,
      terms_date: new Date().toISOString()
    });
  },

  async makeUserVIP(telegramId, vipData = {}) {
    try {
      console.log(`👑 Haciendo usuario ${telegramId} VIP...`);
      
      const { data, error } = await supabase
        .from('users')
        .update({
          vip: true,
          plan: vipData.plan || 'vip',
          plan_price: vipData.plan_price || 0,
          vip_since: vipData.vip_since || new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('telegram_id', telegramId)
        .select()
        .single();
      
      if (error) {
        console.error('❌ Error haciendo usuario VIP:', error);
        throw error;
      }
      
      console.log(`✅ Usuario ${telegramId} marcado como VIP`);
      return data;
    } catch (error) {
      console.error('❌ Error haciendo usuario VIP:', error);
      throw error;
    }
  },

  async removeVIP(telegramId) {
    try {
      console.log(`👑 Removiendo VIP de usuario ${telegramId}...`);
      
      const { data, error } = await supabase
        .from('users')
        .update({
          vip: false,
          plan: null,
          plan_price: null,
          vip_since: null,
          updated_at: new Date().toISOString()
        })
        .eq('telegram_id', telegramId)
        .select()
        .single();
      
      if (error) {
        console.error('❌ Error removiendo VIP:', error);
        throw error;
      }
      
      console.log(`✅ VIP removido de usuario ${telegramId}`);
      return data;
    } catch (error) {
      console.error('❌ Error removiendo VIP:', error);
      throw error;
    }
  },

  async getAllUsers() {
    try {
      console.log('👥 Obteniendo todos los usuarios...');
      
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) {
        console.error('❌ Error obteniendo todos los usuarios:', error);
        throw error;
      }
      
      console.log(`✅ ${data?.length || 0} usuarios encontrados`);
      return data || [];
    } catch (error) {
      console.error('❌ Error obteniendo todos los usuarios:', error);
      return [];
    }
  },

  async getVIPUsers() {
    try {
      console.log('👑 Obteniendo usuarios VIP...');
      
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('vip', true)
        .order('vip_since', { ascending: false });
      
      if (error) {
        console.error('❌ Error obteniendo usuarios VIP:', error);
        throw error;
      }
      
      console.log(`✅ ${data?.length || 0} usuarios VIP encontrados`);
      return data || [];
    } catch (error) {
      console.error('❌ Error obteniendo usuarios VIP:', error);
      return [];
    }
  },

  // ========== PAGOS ==========
  async createPayment(paymentData) {
    try {
      console.log('💰 Creando pago en base de datos...', {
        telegram_id: paymentData.telegram_id,
        plan: paymentData.plan,
        price: paymentData.price,
        status: paymentData.status
      });
      
      const { data, error } = await supabase
        .from('payments')
        .insert([{
          ...paymentData,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }])
        .select()
        .single();
      
      if (error) {
        console.error('❌ Error creando pago:', error);
        throw error;
      }
      
      console.log(`✅ Pago creado con ID: ${data.id}`);
      return data;
    } catch (error) {
      console.error('❌ Error creando pago:', error);
      throw error;
    }
  },

  async getPayment(paymentId) {
    try {
      console.log(`🔍 Buscando pago ${paymentId}...`);
      
      const { data, error } = await supabase
        .from('payments')
        .select('*')
        .eq('id', paymentId)
        .single();
      
      if (error && error.code === 'PGRST116') {
        console.log(`📭 Pago ${paymentId} no encontrado`);
        return null;
      }
      
      if (error) {
        console.error('❌ Error obteniendo pago:', error);
        throw error;
      }
      
      console.log(`✅ Pago ${paymentId} encontrado`);
      return data;
    } catch (error) {
      console.error('❌ Error obteniendo pago:', error);
      return null;
    }
  },

  async getPendingPayments() {
    try {
      console.log('🔍 Buscando pagos pendientes...');
      
      const { data, error } = await supabase
        .from('payments')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      
      if (error) {
        console.error('❌ Error obteniendo pagos pendientes:', error);
        throw error;
      }
      
      console.log(`✅ ${data?.length || 0} pagos pendientes encontrados`);
      return data || [];
    } catch (error) {
      console.error('❌ Error obteniendo pagos pendientes:', error);
      return [];
    }
  },

  async getApprovedPayments() {
    try {
      console
