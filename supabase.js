const { createClient } = require('@supabase/supabase-js');
const fs = require('fs').promises; // Necesitamos esto para leer archivos
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Error: Faltan variables de entorno SUPABASE_URL o SUPABASE_KEY/SUPABASE_ANON_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const db = {
  // ========== STORAGE (IMÁGENES) ==========
  async uploadImage(filePath, telegramId) {
    try {
      // Leer el archivo como buffer
      const fileBuffer = await fs.readFile(filePath);
      const fileName = `screenshot_${telegramId}_${Date.now()}.jpg`;
      
      // Subir a Supabase Storage
      const { data, error } = await supabase.storage
        .from('payments-screenshots')
        .upload(fileName, fileBuffer, {
          contentType: 'image/jpeg',
          cacheControl: '3600',
          upsert: false
        });

      if (error) {
        console.error('Error subiendo imagen a Supabase Storage:', error);
        throw error;
      }

      // Obtener URL pública
      const { data: { publicUrl } } = supabase.storage
        .from('payments-screenshots')
        .getPublicUrl(fileName);

      console.log('✅ Imagen subida a Supabase Storage:', publicUrl);
      return publicUrl;

    } catch (error) {
      console.error('Error en uploadImage:', error);
      throw error;
    }
  },

  // ========== USUARIOS ==========
  async getUser(telegramId) {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('telegram_id', telegramId)
        .single();
      
      if (error && error.code === 'PGRST116') return null;
      if (error) {
        console.error('Error obteniendo usuario:', error.message);
        return null;
      }
      return data;
    } catch (error) {
      console.error('Error en getUser:', error);
      return null;
    }
  },

  async saveUser(telegramId, userData) {
    try {
      // Verificar si el usuario ya existe
      const existingUser = await this.getUser(telegramId);
      
      if (existingUser) {
        // Actualizar usuario existente
        const { data, error } = await supabase
          .from('users')
          .update({
            ...userData,
            updated_at: new Date().toISOString()
          })
          .eq('telegram_id', telegramId)
          .select()
          .single();
        
        if (error) throw error;
        return data;
      } else {
        // Crear nuevo usuario
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
        
        if (error) throw error;
        return data;
      }
    } catch (error) {
      console.error('Error guardando usuario:', error);
      throw error;
    }
  },

  async acceptTerms(telegramId) {
    return await this.saveUser(telegramId, {
      accepted_terms: true,
      terms_date: new Date().toISOString()
    });
  },

  async makeUserVIP(telegramId, vipData = {}) {
    try {
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
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error haciendo usuario VIP:', error);
      throw error;
    }
  },

  async removeVIP(telegramId) {
    try {
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
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error removiendo VIP:', error);
      throw error;
    }
  },

  async getAllUsers() {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error obteniendo todos los usuarios:', error);
      return [];
    }
  },

  async getVIPUsers() {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('vip', true)
        .order('vip_since', { ascending: false });
      
      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error obteniendo usuarios VIP:', error);
      return [];
    }
  },

  // ========== PAGOS ==========
  async createPayment(paymentData) {
    try {
      const { data, error } = await supabase
        .from('payments')
        .insert([{
          ...paymentData,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }])
        .select()
        .single();
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error creando pago:', error);
      throw error;
    }
  },

  async getPayment(paymentId) {
    try {
      const { data, error } = await supabase
        .from('payments')
        .select('*')
        .eq('id', paymentId)
        .single();
      
      if (error && error.code === 'PGRST116') return null;
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error obteniendo pago:', error);
      return null;
    }
  },

  async getPendingPayments() {
    try {
      const { data, error } = await supabase
        .from('payments')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error obteniendo pagos pendientes:', error);
      return [];
    }
  },

  async getApprovedPayments() {
    try {
      const { data, error } = await supabase
        .from('payments')
        .select('*')
        .eq('status', 'approved')
        .order('approved_at', { ascending: false });
      
      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error obteniendo pagos aprobados:', error);
      return [];
    }
  },

  async approvePayment(paymentId) {
    try {
      const { data, error } = await supabase
        .from('payments')
        .update({
          status: 'approved',
          approved_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', paymentId)
        .select()
        .single();
      
      if (error) throw error;
      
      // Hacer usuario VIP
      if (data) {
        await this.makeUserVIP(data.telegram_id, {
          plan: data.plan,
          plan_price: data.price,
          vip_since: new Date().toISOString()
        });
      }
      
      return data;
    } catch (error) {
      console.error('Error aprobando pago:', error);
      throw error;
    }
  },

  async rejectPayment(paymentId, reason) {
    try {
      const { data, error } = await supabase
        .from('payments')
        .update({
          status: 'rejected',
          rejected_at: new Date().toISOString(),
          rejection_reason: reason,
          updated_at: new Date().toISOString()
        })
        .eq('id', paymentId)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error rechazando pago:', error);
      throw error;
    }
  },

  async updatePayment(paymentId, updateData) {
    try {
      const { data, error } = await supabase
        .from('payments')
        .update({
          ...updateData,
          updated_at: new Date().toISOString()
        })
        .eq('id', paymentId)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error actualizando pago:', error);
      throw error;
    }
  },

  async getUserPayments(telegramId) {
    try {
      const { data, error } = await supabase
        .from('payments')
        .select('*')
        .eq('telegram_id', telegramId)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error obteniendo pagos del usuario:', error);
      return [];
    }
  },

  // ========== ARCHIVOS DE CONFIGURACIÓN ==========
  async saveConfigFile(fileData) {
    try {
      const { data, error } = await supabase
        .from('config_files')
        .insert([{
          ...fileData,
          sent_at: new Date().toISOString()
        }])
        .select()
        .single();
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error guardando archivo de configuración:', error);
      throw error;
    }
  },

  // ========== ESTADÍSTICAS ==========
  async getStats() {
    try {
      // Total de usuarios
      const { count: totalUsers, error: usersError } = await supabase
        .from('users')
        .select('*', { count: 'exact', head: true });
      
      if (usersError) throw usersError;
      
      // Usuarios VIP
      const { count: vipUsers, error: vipError } = await supabase
        .from('users')
        .select('*', { count: 'exact', head: true })
        .eq('vip', true);
      
      if (vipError) throw vipError;
      
      // Pagos pendientes
      const { count: pendingPayments, error: pendingError } = await supabase
        .from('payments')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');
      
      if (pendingError) throw pendingError;
      
      // Total de ingresos (suma de pagos aprobados)
      const { data: approvedPayments, error: paymentsError } = await supabase
        .from('payments')
        .select('price')
        .eq('status', 'approved');
      
      if (paymentsError) throw paymentsError;
      
      const totalRevenue = approvedPayments?.reduce((sum, payment) => {
        return sum + (parseFloat(payment.price) || 0);
      }, 0) || 0;
      
      return {
        totalUsers: totalUsers || 0,
        vipUsers: vipUsers || 0,
        pendingPayments: pendingPayments || 0,
        totalRevenue: totalRevenue
      };
    } catch (error) {
      console.error('Error obteniendo estadísticas:', error);
      return {
        totalUsers: 0,
        vipUsers: 0,
        pendingPayments: 0,
        totalRevenue: 0
      };
    }
  }
};

module.exports = db;
