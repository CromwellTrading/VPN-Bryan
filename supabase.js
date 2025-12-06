const { createClient } = require('@supabase/supabase-js');
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
  async uploadImage(fileBuffer, fileName, contentType) {
    try {
      const { data, error } = await supabase.storage
        .from('payments-screenshots')
        .upload(fileName, fileBuffer, {
          contentType: contentType,
          cacheControl: '3600',
          upsert: false
        });

      if (error) throw error;

      // Obtener URL pública
      const { data: urlData } = supabase.storage
        .from('payments-screenshots')
        .getPublicUrl(fileName);

      return {
        path: data.path,
        url: urlData.publicUrl
      };
    } catch (error) {
      console.error('Error subiendo imagen:', error);
      throw error;
    }
  },

  async getImageUrl(fileName) {
    try {
      const { data } = supabase.storage
        .from('payments-screenshots')
        .getPublicUrl(fileName);
      
      return data.publicUrl;
    } catch (error) {
      console.error('Error obteniendo URL de imagen:', error);
      return null;
    }
  },

  async deleteImage(fileName) {
    try {
      const { error } = await supabase.storage
        .from('payments-screenshots')
        .remove([fileName]);
      
      if (error) throw error;
      return true;
    } catch (error) {
      console.error('Error eliminando imagen:', error);
      return false;
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
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error obteniendo usuario:', error);
      return null;
    }
  },

  async saveUser(telegramId, userData) {
    try {
      const existingUser = await this.getUser(telegramId);
      
      if (existingUser) {
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
      const { count: totalUsers, error: usersError } = await supabase
        .from('users')
        .select('*', { count: 'exact', head: true });
      
      if (usersError) throw usersError;
      
      const { count: vipUsers, error: vipError } = await supabase
        .from('users')
        .select('*', { count: 'exact', head: true })
        .eq('vip', true);
      
      if (vipError) throw vipError;
      
      const { count: pendingPayments, error: pendingError } = await supabase
        .from('payments')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');
      
      if (pendingError) throw pendingError;
      
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
