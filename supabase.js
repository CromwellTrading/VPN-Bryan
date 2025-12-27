const { createClient } = require('@supabase/supabase-js');
const fs = require('fs').promises;
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Error: Faltan variables de entorno SUPABASE_URL o SUPABASE_KEY/SUPABASE_ANON_KEY');
  process.exit(1);
}

// Cliente para operaciones normales (usando anon key)
const supabase = createClient(supabaseUrl, supabaseKey);

// Cliente para operaciones de administración (usando service role key) - solo para storage
const supabaseAdmin = supabaseServiceKey ? createClient(supabaseUrl, supabaseServiceKey) : supabase;

const db = {
  // ========== STORAGE (IMÁGENES Y ARCHIVOS) ==========
  async uploadImage(filePath, telegramId) {
    try {
      console.log(`📤 Subiendo imagen para usuario ${telegramId}: ${filePath}`);
      
      const fileBuffer = await fs.readFile(filePath);
      const fileName = `screenshot_${telegramId}_${Date.now()}.jpg`;
      
      console.log(`📁 Nombre del archivo en storage: ${fileName}`);
      
      // Usar el cliente admin para evitar problemas de RLS
      const { data, error } = await supabaseAdmin.storage
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

      const { data: { publicUrl } } = supabaseAdmin.storage
        .from('payments-screenshots')
        .getPublicUrl(fileName);

      console.log(`✅ URL pública obtenida: ${publicUrl}`);
      return publicUrl;

    } catch (error) {
      console.error('❌ Error en uploadImage:', error);
      throw error;
    }
  },

  async uploadPlanFile(fileBuffer, plan, fileName) {
    try {
      console.log(`📤 Subiendo archivo para plan ${plan}: ${fileName}`);
      
      // Determinar content type
      const extension = fileName.split('.').pop().toLowerCase();
      let contentType = 'application/octet-stream';
      if (extension === 'conf') contentType = 'text/plain';
      if (extension === 'zip') contentType = 'application/zip';
      if (extension === 'rar') contentType = 'application/x-rar-compressed';
      
      const storageFileName = `plan_${plan}_${Date.now()}_${fileName}`;
      
      // Usar el cliente admin para evitar problemas de RLS
      const { data, error } = await supabaseAdmin.storage
        .from('plan-files')
        .upload(storageFileName, fileBuffer, {
          contentType: contentType,
          cacheControl: '3600',
          upsert: true
        });

      if (error) {
        console.error('❌ Error subiendo archivo de plan:', error);
        throw error;
      }

      const { data: { publicUrl } } = supabaseAdmin.storage
        .from('plan-files')
        .getPublicUrl(storageFileName);

      console.log(`✅ Archivo de plan subido: ${publicUrl}`);
      return {
        filename: storageFileName,
        publicUrl: publicUrl,
        originalName: fileName
      };

    } catch (error) {
      console.error('❌ Error en uploadPlanFile:', error);
      throw error;
    }
  },

  async deleteOldPlanFile(oldFileName) {
    try {
      if (!oldFileName) return;
      
      const { error } = await supabaseAdmin.storage
        .from('plan-files')
        .remove([oldFileName]);
      
      if (error) {
        console.error('❌ Error eliminando archivo antiguo:', error);
      } else {
        console.log(`✅ Archivo antiguo eliminado: ${oldFileName}`);
      }
    } catch (error) {
      console.error('❌ Error en deleteOldPlanFile:', error);
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
        
        const updateData = {
          ...userData,
          updated_at: new Date().toISOString(),
          last_activity: new Date().toISOString()
        };
        
        // Si se envía trial_requested, actualizar también trial_requested_at
        if (userData.trial_requested && !existingUser.trial_requested) {
          updateData.trial_requested_at = new Date().toISOString();
        }
        
        // Si se envía trial_received, actualizar también trial_sent_at
        if (userData.trial_received && !existingUser.trial_received) {
          updateData.trial_sent_at = new Date().toISOString();
        }
        
        // Si se envía referrer_id, guardarlo
        if (userData.referrer_id && !existingUser.referrer_id) {
          updateData.referrer_id = userData.referrer_id;
          updateData.referrer_username = userData.referrer_username;
        }
        
        const { data, error } = await supabase
          .from('users')
          .update(updateData)
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
        
        const insertData = {
          telegram_id: telegramId,
          ...userData,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          last_activity: new Date().toISOString()
        };
        
        const { data, error } = await supabase
          .from('users')
          .insert([insertData])
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

  async updateUser(telegramId, updateData) {
    try {
      console.log(`✏️ Actualizando usuario ${telegramId}...`);
      
      const { data, error } = await supabase
        .from('users')
        .update({
          ...updateData,
          updated_at: new Date().toISOString()
        })
        .eq('telegram_id', telegramId)
        .select()
        .single();
      
      if (error) {
        console.error('❌ Error actualizando usuario:', error);
        throw error;
      }
      
      console.log(`✅ Usuario ${telegramId} actualizado`);
      return data;
    } catch (error) {
      console.error('❌ Error actualizando usuario:', error);
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

  async getActiveUsers(days = 30) {
    try {
      console.log(`📱 Obteniendo usuarios activos (últimos ${days} días)...`);
      
      const date = new Date();
      date.setDate(date.getDate() - days);
      
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .gte('last_activity', date.toISOString())
        .order('last_activity', { ascending: false });
      
      if (error) {
        console.error('❌ Error obteniendo usuarios activos:', error);
        throw error;
      }
      
      console.log(`✅ ${data?.length || 0} usuarios activos encontrados`);
      return data || [];
    } catch (error) {
      console.error('❌ Error obteniendo usuarios activos:', error);
      return [];
    }
  },

  // ========== REFERIDOS ==========
  async createReferral(referrerId, referredId, referredUsername = null, referredName = null) {
    try {
      console.log(`🤝 Creando referido: ${referrerId} -> ${referredId}`);
      
      // Verificar si ya existe este referido
      const { data: existing, error: checkError } = await supabase
        .from('referrals')
        .select('id')
        .eq('referrer_id', referrerId)
        .eq('referred_id', referredId)
        .single();
      
      if (existing) {
        console.log(`✅ Referido ya existe`);
        return existing;
      }
      
      // Crear nuevo referido (Nivel 1)
      const { data, error } = await supabase
        .from('referrals')
        .insert([{
          referrer_id: referrerId,
          referred_id: referredId,
          referred_username: referredUsername,
          referred_name: referredName,
          level: 1,
          has_paid: false,
          created_at: new Date().toISOString()
        }])
        .select()
        .single();
      
      if (error) {
        console.error('❌ Error creando referido:', error);
        throw error;
      }
      
      console.log(`✅ Referido creado con ID: ${data.id}`);
      
      // Buscar referidor del referrer para crear nivel 2
      const { data: referrerReferrals } = await supabase
        .from('referrals')
        .select('referrer_id')
        .eq('referred_id', referrerId)
        .eq('level', 1)
        .single();
      
      if (referrerReferrals && referrerReferrals.referrer_id) {
        // Crear referido nivel 2
        await supabase
          .from('referrals')
          .insert([{
            referrer_id: referrerReferrals.referrer_id,
            referred_id: referredId,
            referred_username: referredUsername,
            referred_name: referredName,
            level: 2,
            has_paid: false,
            created_at: new Date().toISOString()
          }]);
        
        console.log(`✅ Referido nivel 2 creado`);
      }
      
      return data;
    } catch (error) {
      console.error('❌ Error creando referido:', error);
      throw error;
    }
  },

  async getReferralStats(telegramId) {
    try {
      console.log(`📊 Obteniendo estadísticas de referidos para ${telegramId}`);
      
      // Obtener referidos directos (nivel 1)
      const { data: level1, error: error1 } = await supabase
        .from('referrals')
        .select('*')
        .eq('referrer_id', telegramId)
        .eq('level', 1);
      
      if (error1) {
        console.error('❌ Error obteniendo referidos nivel 1:', error1);
        return {
          level1: { total: 0, paid: 0 },
          level2: { total: 0, paid: 0 },
          total_referrals: 0,
          total_paid: 0,
          discount_percentage: 0
        };
      }
      
      // Obtener referidos indirectos (nivel 2)
      const { data: level2, error: error2 } = await supabase
        .from('referrals')
        .select('*')
        .eq('referrer_id', telegramId)
        .eq('level', 2);
      
      if (error2) {
        console.error('❌ Error obteniendo referidos nivel 2:', error2);
        return {
          level1: { total: level1?.length || 0, paid: 0 },
          level2: { total: 0, paid: 0 },
          total_referrals: level1?.length || 0,
          total_paid: 0,
          discount_percentage: 0
        };
      }
      
      // Contar referidos que han pagado
      const level1Paid = level1?.filter(r => r.has_paid).length || 0;
      const level2Paid = level2?.filter(r => r.has_paid).length || 0;
      
      // Calcular descuento (20% por nivel 1, 10% por nivel 2)
      const discount = (level1Paid * 20) + (level2Paid * 10);
      
      return {
        level1: {
          total: level1?.length || 0,
          paid: level1Paid
        },
        level2: {
          total: level2?.length || 0,
          paid: level2Paid
        },
        total_referrals: (level1?.length || 0) + (level2?.length || 0),
        total_paid: level1Paid + level2Paid,
        discount_percentage: discount > 100 ? 100 : discount
      };
    } catch (error) {
      console.error('❌ Error obteniendo estadísticas de referidos:', error);
      return {
        level1: { total: 0, paid: 0 },
        level2: { total: 0, paid: 0 },
        total_referrals: 0,
        total_paid: 0,
        discount_percentage: 0
      };
    }
  },

  async getAllReferralsStats() {
    try {
      console.log('📊 Obteniendo estadísticas generales de referidos');
      
      const { data: referrals, error } = await supabase
        .from('referrals')
        .select('*');
      
      if (error) {
        console.error('❌ Error obteniendo todos los referidos:', error);
        return {
          total_referrals: 0,
          total_paid: 0,
          top_referrers: [],
          recent_referrals: []
        };
      }
      
      // Agrupar por referidor
      const referrersMap = new Map();
      
      referrals?.forEach(referral => {
        const referrerId = referral.referrer_id;
        if (!referrersMap.has(referrerId)) {
          referrersMap.set(referrerId, {
            referrer_id: referrerId,
            total: 0,
            paid: 0,
            level1: 0,
            level2: 0
          });
        }
        
        const stats = referrersMap.get(referrerId);
        stats.total++;
        if (referral.has_paid) stats.paid++;
        if (referral.level === 1) stats.level1++;
        if (referral.level === 2) stats.level2++;
      });
      
      // Convertir a array y ordenar
      const topReferrers = Array.from(referrersMap.values())
        .sort((a, b) => b.total - a.total)
        .slice(0, 10);
      
      // Referidos recientes
      const recentReferrals = referrals
        ?.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, 10) || [];
      
      return {
        total_referrals: referrals?.length || 0,
        total_paid: referrals?.filter(r => r.has_paid).length || 0,
        top_referrers,
        recent_referrals
      };
    } catch (error) {
      console.error('❌ Error en getAllReferralsStats:', error);
      return {
        total_referrals: 0,
        total_paid: 0,
        top_referrers: [],
        recent_referrals: []
      };
    }
  },

  async markReferralAsPaid(referredId) {
    try {
      console.log(`💰 Marcando referido ${referredId} como pagado`);
      
      const { data, error } = await supabase
        .from('referrals')
        .update({ has_paid: true })
        .eq('referred_id', referredId)
        .select();
      
      if (error) {
        console.error('❌ Error marcando referido como pagado:', error);
        throw error;
      }
      
      console.log(`✅ Referido ${referredId} marcado como pagado`);
      return data;
    } catch (error) {
      console.error('❌ Error en markReferralAsPaid:', error);
      throw error;
    }
  },

  async getReferralsByReferrer(referrerId) {
    try {
      console.log(`🔍 Obteniendo referidos de ${referrerId}`);
      
      const { data, error } = await supabase
        .from('referrals')
        .select('*')
        .eq('referrer_id', referrerId)
        .order('created_at', { ascending: false });
      
      if (error) {
        console.error('❌ Error obteniendo referidos:', error);
        return [];
      }
      
      return data || [];
    } catch (error) {
      console.error('❌ Error en getReferralsByReferrer:', error);
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
      console.log('🔍 Buscando pagos aprobados...');
      
      const { data, error } = await supabase
        .from('payments')
        .select('*')
        .eq('status', 'approved')
        .order('created_at', { ascending: false });
      
      if (error) {
        console.error('❌ Error obteniendo pagos aprobados:', error);
        throw error;
      }
      
      console.log(`✅ ${data?.length || 0} pagos aprobados encontrados`);
      return data || [];
    } catch (error) {
      console.error('❌ Error obteniendo pagos aprobados:', error);
      return [];
    }
  },

  async approvePayment(paymentId) {
    try {
      console.log(`✅ Aprobando pago ${paymentId}...`);
      
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
      
      if (error) {
        console.error('❌ Error aprobando pago:', error);
        throw error;
      }
      
      console.log(`✅ Pago ${paymentId} aprobado`);
      return data;
    } catch (error) {
      console.error('❌ Error aprobando pago:', error);
      throw error;
    }
  },

  async rejectPayment(paymentId, reason) {
    try {
      console.log(`❌ Rechazando pago ${paymentId} con motivo: ${reason}`);
      
      const { data, error } = await supabase
        .from('payments')
        .update({
          status: 'rejected',
          rejected_reason: reason,
          rejected_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', paymentId)
        .select()
        .single();
      
      if (error) {
        console.error('❌ Error rechazando pago:', error);
        throw error;
      }
      
      console.log(`✅ Pago ${paymentId} rechazado`);
      return data;
    } catch (error) {
      console.error('❌ Error rechazando pago:', error);
      throw error;
    }
  },

  async updatePayment(paymentId, updateData) {
    try {
      console.log(`✏️ Actualizando pago ${paymentId}...`);
      
      const { data, error } = await supabase
        .from('payments')
        .update({
          ...updateData,
          updated_at: new Date().toISOString()
        })
        .eq('id', paymentId)
        .select()
        .single();
      
      if (error) {
        console.error('❌ Error actualizando pago:', error);
        throw error;
      }
      
      console.log(`✅ Pago ${paymentId} actualizado`);
      return data;
    } catch (error) {
      console.error('❌ Error actualizando pago:', error);
      throw error;
    }
  },

  async getUserPayments(telegramId) {
    try {
      console.log(`📊 Obteniendo pagos del usuario ${telegramId}...`);
      
      const { data, error } = await supabase
        .from('payments')
        .select('*')
        .eq('telegram_id', telegramId)
        .order('created_at', { ascending: false });
      
      if (error) {
        console.error('❌ Error obteniendo pagos del usuario:', error);
        throw error;
      }
      
      console.log(`✅ ${data?.length || 0} pagos encontrados para usuario ${telegramId}`);
      return data || [];
    } catch (error) {
      console.error('❌ Error obteniendo pagos del usuario:', error);
      return [];
    }
  },

  // ========== PAGOS USDT ==========
  async createUsdtPayment(usdtData) {
    try {
      console.log('💸 Creando pago USDT...');
      
      const { data, error } = await supabase
        .from('usdt_payments')
        .insert([{
          ...usdtData,
          status: 'pending',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }])
        .select()
        .single();
      
      if (error) {
        console.error('❌ Error creando pago USDT:', error);
        throw error;
      }
      
      console.log(`✅ Pago USDT creado con ID: ${data.id}`);
      return data;
    } catch (error) {
      console.error('❌ Error creando pago USDT:', error);
      throw error;
    }
  },

  async getUsdtPaymentByAddress(address) {
    try {
      console.log(`🔍 Buscando pago USDT con dirección: ${address}`);
      
      const { data, error } = await supabase
        .from('usdt_payments')
        .select('*')
        .eq('usdt_address', address)
        .single();
      
      if (error && error.code === 'PGRST116') {
        console.log(`📭 Pago USDT no encontrado`);
        return null;
      }
      
      if (error) {
        console.error('❌ Error obteniendo pago USDT:', error);
        throw error;
      }
      
      console.log(`✅ Pago USDT encontrado`);
      return data;
    } catch (error) {
      console.error('❌ Error obteniendo pago USDT:', error);
      return null;
    }
  },

  async updateUsdtPaymentStatus(address, status, transactionHash = null) {
    try {
      console.log(`✏️ Actualizando pago USDT ${address} a ${status}`);
      
      const updateData = {
        status: status,
        updated_at: new Date().toISOString()
      };
      
      if (transactionHash) {
        updateData.transaction_hash = transactionHash;
      }
      
      if (status === 'completed') {
        updateData.completed_at = new Date().toISOString();
      }
      
      const { data, error } = await supabase
        .from('usdt_payments')
        .update(updateData)
        .eq('usdt_address', address)
        .select()
        .single();
      
      if (error) {
        console.error('❌ Error actualizando pago USDT:', error);
        throw error;
      }
      
      console.log(`✅ Pago USDT actualizado`);
      return data;
    } catch (error) {
      console.error('❌ Error actualizando pago USDT:', error);
      throw error;
    }
  },

  async getPendingUsdtPayments() {
    try {
      console.log('🔍 Buscando pagos USDT pendientes...');
      
      const { data, error } = await supabase
        .from('usdt_payments')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      
      if (error) {
        console.error('❌ Error obteniendo pagos USDT pendientes:', error);
        throw error;
      }
      
      console.log(`✅ ${data?.length || 0} pagos USDT pendientes encontrados`);
      return data || [];
    } catch (error) {
      console.error('❌ Error obteniendo pagos USDT pendientes:', error);
      return [];
    }
  },

  async getCompletedUsdtPayments() {
    try {
      console.log('🔍 Buscando pagos USDT completados...');
      
      const { data, error } = await supabase
        .from('usdt_payments')
        .select('*')
        .eq('status', 'completed')
        .order('created_at', { ascending: false });
      
      if (error) {
        console.error('❌ Error obteniendo pagos USDT completados:', error);
        throw error;
      }
      
      console.log(`✅ ${data?.length || 0} pagos USDT completados encontrados`);
      return data || [];
    } catch (error) {
      console.error('❌ Error obteniendo pagos USDT completados:', error);
      return [];
    }
  },

  // ========== ARCHIVOS DE PLANES ==========
  async savePlanFile(planFileData) {
    try {
      console.log(`💾 Guardando información de archivo de plan...`);
      
      // Verificar si ya existe un archivo para este plan
      const { data: existing } = await supabase
        .from('plan_files')
        .select('*')
        .eq('plan', planFileData.plan)
        .single();
      
      if (existing) {
        // Actualizar archivo existente
        const { data, error } = await supabase
          .from('plan_files')
          .update({
            ...planFileData,
            updated_at: new Date().toISOString()
          })
          .eq('plan', planFileData.plan)
          .select()
          .single();
        
        if (error) {
          console.error('❌ Error actualizando archivo de plan:', error);
          throw error;
        }
        
        console.log(`✅ Archivo de plan actualizado: ${planFileData.plan}`);
        return data;
      } else {
        // Crear nuevo registro
        const { data, error } = await supabase
          .from('plan_files')
          .insert([{
            ...planFileData,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }])
          .select()
          .single();
        
        if (error) {
          console.error('❌ Error creando archivo de plan:', error);
          throw error;
        }
        
        console.log(`✅ Archivo de plan creado: ${planFileData.plan}`);
        return data;
      }
    } catch (error) {
      console.error('❌ Error guardando archivo de plan:', error);
      throw error;
    }
  },

  async getPlanFile(plan) {
    try {
      console.log(`🔍 Buscando archivo de plan: ${plan}`);
      
      const { data, error } = await supabase
        .from('plan_files')
        .select('*')
        .eq('plan', plan)
        .single();
      
      if (error && error.code === 'PGRST116') {
        console.log(`📭 Archivo de plan ${plan} no encontrado`);
        return null;
      }
      
      if (error) {
        console.error('❌ Error obteniendo archivo de plan:', error);
        throw error;
      }
      
      console.log(`✅ Archivo de plan encontrado: ${plan}`);
      return data;
    } catch (error) {
      console.error('❌ Error obteniendo archivo de plan:', error);
      return null;
    }
  },

  async getAllPlanFiles() {
    try {
      console.log('🔍 Obteniendo todos los archivos de planes...');
      
      const { data, error } = await supabase
        .from('plan_files')
        .select('*')
        .order('plan', { ascending: true });
      
      if (error) {
        console.error('❌ Error obteniendo archivos de planes:', error);
        throw error;
      }
      
      console.log(`✅ ${data?.length || 0} archivos de planes encontrados`);
      return data || [];
    } catch (error) {
      console.error('❌ Error obteniendo archivos de planes:', error);
      return [];
    }
  },

  async deletePlanFile(plan) {
    try {
      console.log(`🗑️ Eliminando archivo de plan: ${plan}`);
      
      const { data: fileData } = await this.getPlanFile(plan);
      if (fileData && fileData.storage_filename) {
        // Eliminar del storage usando el cliente admin
        const { error: deleteError } = await supabaseAdmin.storage
          .from('plan-files')
          .remove([fileData.storage_filename]);
        
        if (deleteError) {
          console.error('❌ Error eliminando archivo de storage:', deleteError);
        } else {
          console.log(`✅ Archivo eliminado de storage: ${fileData.storage_filename}`);
        }
      }
      
      const { data, error } = await supabase
        .from('plan_files')
        .delete()
        .eq('plan', plan)
        .select()
        .single();
      
      if (error) {
        console.error('❌ Error eliminando archivo de plan:', error);
        throw error;
      }
      
      console.log(`✅ Archivo de plan eliminado: ${plan}`);
      return data;
    } catch (error) {
      console.error('❌ Error eliminando archivo de plan:', error);
      throw error;
    }
  },

  // ========== ESTADÍSTICAS ==========
  async getStats() {
    try {
      console.log('📊 Obteniendo estadísticas...');
      
      // Obtener estadísticas de usuarios
      const { data: usersData, error: usersError } = await supabase
        .from('users')
        .select('vip, created_at, trial_requested, trial_received, referrer_id, referrer_username');
      
      if (usersError) {
        console.error('❌ Error obteniendo usuarios para estadísticas:', usersError);
        throw usersError;
      }
      
      const totalUsers = usersData?.length || 0;
      const vipUsers = usersData?.filter(u => u.vip)?.length || 0;
      const trialRequests = usersData?.filter(u => u.trial_requested)?.length || 0;
      const trialReceived = usersData?.filter(u => u.trial_received)?.length || 0;
      const usersWithReferrer = usersData?.filter(u => u.referrer_id)?.length || 0;
      
      // Obtener estadísticas de pagos
      const { data: paymentsData, error: paymentsError } = await supabase
        .from('payments')
        .select('status, price, method');
      
      if (paymentsError) {
        console.error('❌ Error obteniendo pagos para estadísticas:', paymentsError);
        throw paymentsError;
      }
      
      const totalPayments = paymentsData?.length || 0;
      const pendingPayments = paymentsData?.filter(p => p.status === 'pending')?.length || 0;
      const approvedPayments = paymentsData?.filter(p => p.status === 'approved')?.length || 0;
      const rejectedPayments = paymentsData?.filter(p => p.status === 'rejected')?.length || 0;
      const usdtPayments = paymentsData?.filter(p => p.method === 'usdt')?.length || 0;
      
      // Calcular ingresos totales
      const totalRevenue = paymentsData
        ?.filter(p => p.status === 'approved' && p.price)
        ?.reduce((sum, p) => sum + (parseFloat(p.price) || 0), 0) || 0;
      
      // Obtener estadísticas de referidos
      const referralsStats = await this.getAllReferralsStats();
      
      // Obtener estadísticas de USDT
      const { data: usdtData } = await supabase
        .from('usdt_payments')
        .select('status');
      
      const totalUsdtPayments = usdtData?.length || 0;
      const pendingUsdt = usdtData?.filter(p => p.status === 'pending')?.length || 0;
      const completedUsdt = usdtData?.filter(p => p.status === 'completed')?.length || 0;
      
      // Obtener estadísticas de broadcasts
      const { data: broadcastsData } = await supabase
        .from('broadcasts')
        .select('status');
      
      const totalBroadcasts = broadcastsData?.length || 0;
      const completedBroadcasts = broadcastsData?.filter(b => b.status === 'completed')?.length || 0;
      
      return {
        users: {
          total: totalUsers,
          vip: vipUsers,
          regular: totalUsers - vipUsers,
          trial_requests: trialRequests,
          trial_received: trialReceived,
          trial_pending: trialRequests - trialReceived,
          with_referrer: usersWithReferrer
        },
        payments: {
          total: totalPayments,
          pending: pendingPayments,
          approved: approvedPayments,
          rejected: rejectedPayments,
          usdt: usdtPayments
        },
        revenue: {
          total: totalRevenue,
          average: approvedPayments > 0 ? totalRevenue / approvedPayments : 0
        },
        referrals: referralsStats,
        usdt: {
          total: totalUsdtPayments,
          pending: pendingUsdt,
          completed: completedUsdt
        },
        broadcasts: {
          total: totalBroadcasts,
          completed: completedBroadcasts
        }
      };
    } catch (error) {
      console.error('❌ Error obteniendo estadísticas:', error);
      return {
        users: { 
          total: 0, 
          vip: 0, 
          regular: 0, 
          trial_requests: 0,
          trial_received: 0,
          trial_pending: 0,
          with_referrer: 0
        },
        payments: { 
          total: 0, 
          pending: 0, 
          approved: 0, 
          rejected: 0,
          usdt: 0
        },
        revenue: { 
          total: 0, 
          average: 0
        },
        referrals: {
          total_referrals: 0,
          total_paid: 0,
          top_referrers: [],
          recent_referrals: []
        },
        usdt: {
          total: 0,
          pending: 0,
          completed: 0
        },
        broadcasts: {
          total: 0,
          completed: 0
        }
      };
    }
  },

  // ========== FUNCIONES DE PRUEBA GRATUITA ==========
  async getTrialStats() {
    try {
      console.log('🎯 Obteniendo estadísticas de pruebas...');
      
      const { data, error } = await supabase
        .from('users')
        .select('trial_requested, trial_received, trial_requested_at, trial_sent_at, trial_plan_type')
        .eq('trial_requested', true);
      
      if (error) {
        console.error('❌ Error obteniendo estadísticas de prueba:', error);
        throw error;
      }
      
      const totalRequests = data?.length || 0;
      const completedTrials = data?.filter(u => u.trial_received)?.length || 0;
      const pendingTrials = totalRequests - completedTrials;
      
      // Calcular solicitudes de hoy
      const today = new Date().toISOString().split('T')[0];
      const todayRequests = data?.filter(u => 
        u.trial_requested_at && u.trial_requested_at.startsWith(today)
      )?.length || 0;
      
      // Calcular por tipo de prueba
      const trialByType = {
        '1h': data?.filter(u => u.trial_plan_type === '1h')?.length || 0,
        '24h': data?.filter(u => u.trial_plan_type === '24h')?.length || 0
      };
      
      return {
        total_requests: totalRequests,
        completed: completedTrials,
        pending: pendingTrials,
        today_requests: todayRequests,
        by_type: trialByType
      };
    } catch (error) {
      console.error('❌ Error en getTrialStats:', error);
      return {
        total_requests: 0,
        completed: 0,
        pending: 0,
        today_requests: 0,
        by_type: {}
      };
    }
  },

  async getPendingTrials() {
    try {
      console.log('⏳ Obteniendo pruebas pendientes...');
      
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('trial_requested', true)
        .eq('trial_received', false)
        .order('trial_requested_at', { ascending: true });
      
      if (error) {
        console.error('❌ Error obteniendo pruebas pendientes:', error);
        throw error;
      }
      
      console.log(`✅ ${data?.length || 0} pruebas pendientes encontradas`);
      return data || [];
    } catch (error) {
      console.error('❌ Error en getPendingTrials:', error);
      return [];
    }
  },

  async markTrialAsSent(telegramId, sentBy) {
    try {
      console.log(`✅ Marcando prueba como enviada para ${telegramId}...`);
      
      const { data, error } = await supabase
        .from('users')
        .update({
          trial_received: true,
          trial_sent_at: new Date().toISOString(),
          trial_sent_by: sentBy,
          updated_at: new Date().toISOString()
        })
        .eq('telegram_id', telegramId)
        .select()
        .single();
      
      if (error) {
        console.error('❌ Error marcando prueba como enviada:', error);
        throw error;
      }
      
      console.log(`✅ Prueba marcada como enviada para ${telegramId}`);
      return data;
    } catch (error) {
      console.error('❌ Error en markTrialAsSent:', error);
      throw error;
    }
  },

  async checkTrialEligibility(telegramId) {
    try {
      console.log(`🔍 Verificando elegibilidad para prueba de ${telegramId}...`);
      
      const user = await this.getUser(telegramId);
      
      if (!user) {
        return {
          eligible: true,
          reason: 'Nuevo usuario'
        };
      }
      
      // Verificar si ya solicitó prueba
      if (!user.trial_requested) {
        return {
          eligible: true,
          reason: 'Primera solicitud'
        };
      }
      
      // Verificar si ya recibió prueba
      if (user.trial_requested && !user.trial_received) {
        return {
          eligible: false,
          reason: 'Ya tiene una solicitud pendiente'
        };
      }
      
      // Verificar si recibió prueba hace menos de 30 días
      if (user.trial_received && user.trial_sent_at) {
        const lastTrialDate = new Date(user.trial_sent_at);
        const now = new Date();
        const daysSinceLastTrial = Math.floor((now - lastTrialDate) / (1000 * 60 * 60 * 24));
        
        if (daysSinceLastTrial < 30) {
          return {
            eligible: false,
            reason: `Debe esperar ${30 - daysSinceLastTrial} días para solicitar otra prueba`,
            days_remaining: 30 - daysSinceLastTrial
          };
        }
      }
      
      return {
        eligible: true,
        reason: 'Puede solicitar nueva prueba'
      };
    } catch (error) {
      console.error('❌ Error en checkTrialEligibility:', error);
      return {
        eligible: false,
        reason: 'Error verificando elegibilidad'
      };
    }
  },

  // ========== FUNCIONES DE BROADCAST ==========
  async createBroadcast(message, targetUsers = 'all', sentBy) {
    try {
      console.log(`📢 Creando broadcast...`);
      
      const { data, error } = await supabase
        .from('broadcasts')
        .insert([{
          message: message,
          target_users: targetUsers,
          sent_by: sentBy,
          status: 'pending',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }])
        .select()
        .single();
      
      if (error) {
        console.error('❌ Error creando broadcast:', error);
        throw error;
      }
      
      console.log(`✅ Broadcast creado con ID: ${data.id}`);
      return data;
    } catch (error) {
      console.error('❌ Error creando broadcast:', error);
      throw error;
    }
  },

  async getBroadcasts(limit = 50) {
    try {
      console.log('📢 Obteniendo broadcasts...');
      
      const { data, error } = await supabase
        .from('broadcasts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);
      
      if (error) {
        console.error('❌ Error obteniendo broadcasts:', error);
        throw error;
      }
      
      console.log(`✅ ${data?.length || 0} broadcasts encontrados`);
      return data || [];
    } catch (error) {
      console.error('❌ Error obteniendo broadcasts:', error);
      return [];
    }
  },

  async getBroadcast(broadcastId) {
    try {
      console.log(`🔍 Obteniendo broadcast ${broadcastId}...`);
      
      if (!broadcastId || isNaN(parseInt(broadcastId))) {
        console.log(`❌ ID de broadcast inválido: ${broadcastId}`);
        return null;
      }
      
      const { data, error } = await supabase
        .from('broadcasts')
        .select('*')
        .eq('id', parseInt(broadcastId))
        .single();
      
      if (error && error.code === 'PGRST116') {
        console.log(`📭 Broadcast ${broadcastId} no encontrado`);
        return null;
      }
      
      if (error) {
        console.error('❌ Error obteniendo broadcast:', error);
        throw error;
      }
      
      console.log(`✅ Broadcast ${broadcastId} encontrado`);
      return data;
    } catch (error) {
      console.error('❌ Error obteniendo broadcast:', error);
      return null;
    }
  },

  async updateBroadcastStatus(broadcastId, status, stats = {}) {
    try {
      console.log(`✏️ Actualizando broadcast ${broadcastId} a ${status}...`);
      
      const updateData = {
        status: status,
        updated_at: new Date().toISOString()
      };
      
      if (status === 'completed' || status === 'failed') {
        updateData.completed_at = new Date().toISOString();
        updateData.sent_count = stats.sent_count || 0;
        updateData.failed_count = stats.failed_count || 0;
        updateData.total_users = stats.total_users || 0;
      } else if (status === 'sending') {
        updateData.sent_count = stats.sent_count || 0;
        updateData.total_users = stats.total_users || 0;
      }
      
      const { data, error } = await supabase
        .from('broadcasts')
        .update(updateData)
        .eq('id', broadcastId)
        .select()
        .single();
      
      if (error) {
        console.error('❌ Error actualizando broadcast:', error);
        throw error;
      }
      
      console.log(`✅ Broadcast ${broadcastId} actualizado a ${status}`);
      return data;
    } catch (error) {
      console.error('❌ Error actualizando broadcast:', error);
      throw error;
    }
  },

  async getUsersForBroadcast(targetUsers = 'all') {
    try {
      console.log(`👥 Obteniendo usuarios para broadcast: ${targetUsers}...`);
      
      let query = supabase
        .from('users')
        .select('telegram_id, username, first_name, vip, trial_requested, trial_received, last_activity');
      
      if (targetUsers === 'vip') {
        query = query.eq('vip', true);
      } else if (targetUsers === 'non_vip') {
        query = query.eq('vip', false);
      } else if (targetUsers === 'trial_pending') {
        query = query.eq('trial_requested', true).eq('trial_received', false);
      } else if (targetUsers === 'trial_received') {
        query = query.eq('trial_received', true);
      } else if (targetUsers === 'active') {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        query = query.gte('last_activity', thirtyDaysAgo.toISOString());
      }
      
      const { data, error } = await query;
      
      if (error) {
        console.error('❌ Error obteniendo usuarios para broadcast:', error);
        throw error;
      }
      
      console.log(`✅ ${data?.length || 0} usuarios encontrados para broadcast`);
      return data || [];
    } catch (error) {
      console.error('❌ Error obteniendo usuarios para broadcast:', error);
      return [];
    }
  },

  // ========== FUNCIONES ADICIONALES ==========
  async searchUsers(searchTerm) {
    try {
      console.log(`🔍 Buscando usuarios con término: ${searchTerm}`);
      
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .or(`telegram_id.ilike.%${searchTerm}%,username.ilike.%${searchTerm}%,first_name.ilike.%${searchTerm}%`)
        .order('created_at', { ascending: false })
        .limit(50);
      
      if (error) {
        console.error('❌ Error buscando usuarios:', error);
        return [];
      }
      
      console.log(`✅ ${data?.length || 0} usuarios encontrados`);
      return data || [];
    } catch (error) {
      console.error('❌ Error en searchUsers:', error);
      return [];
    }
  },

  async searchPayments(searchTerm) {
    try {
      console.log(`🔍 Buscando pagos con término: ${searchTerm}`);
      
      const { data, error } = await supabase
        .from('payments')
        .select('*')
        .or(`id.eq.${searchTerm},telegram_id.ilike.%${searchTerm}%`)
        .order('created_at', { ascending: false })
        .limit(50);
      
      if (error) {
        console.error('❌ Error buscando pagos:', error);
        return [];
      }
      
      console.log(`✅ ${data?.length || 0} pagos encontrados`);
      return data || [];
    } catch (error) {
      console.error('❌ Error en searchPayments:', error);
      return [];
    }
  },

  async getRecentActivity(limit = 20) {
    try {
      console.log(`📅 Obteniendo actividad reciente (${limit} items)...`);
      
      const { data: payments, error: paymentsError } = await supabase
        .from('payments')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);
      
      if (paymentsError) {
        console.error('❌ Error obteniendo pagos recientes:', paymentsError);
        return [];
      }
      
      const { data: users, error: usersError } = await supabase
        .from('users')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);
      
      if (usersError) {
        console.error('❌ Error obteniendo usuarios recientes:', usersError);
        return [];
      }
      
      const activity = [
        ...payments.map(p => ({
          type: 'payment',
          id: p.id,
          telegram_id: p.telegram_id,
          status: p.status,
          plan: p.plan,
          price: p.price,
          created_at: p.created_at,
          updated_at: p.updated_at
        })),
        ...users.map(u => ({
          type: 'user',
          id: u.id,
          telegram_id: u.telegram_id,
          username: u.username,
          first_name: u.first_name,
          vip: u.vip,
          trial_requested: u.trial_requested,
          trial_received: u.trial_received,
          created_at: u.created_at,
          updated_at: u.updated_at
        }))
      ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
       .slice(0, limit);
      
      console.log(`✅ ${activity.length} actividades recientes obtenidas`);
      return activity;
    } catch (error) {
      console.error('❌ Error en getRecentActivity:', error);
      return [];
    }
  },

  async getGamesStatistics() {
    try {
      console.log('📊 Obteniendo estadísticas de juegos...');
      
      const { data, error } = await supabase
        .from('users')
        .select('trial_game_server, trial_connection_type, trial_requested_at')
        .eq('trial_requested', true);
      
      if (error) {
        console.error('❌ Error obteniendo estadísticas de juegos:', error);
        return { games: [], connections: [] };
      }
      
      const gamesMap = new Map();
      const connectionsMap = new Map();
      
      data?.forEach(user => {
        const game = user.trial_game_server || 'No especificado';
        const connection = user.trial_connection_type || 'No especificado';
        
        if (!gamesMap.has(game)) {
          gamesMap.set(game, { game, count: 0, lastRequest: user.trial_requested_at });
        }
        const gameData = gamesMap.get(game);
        gameData.count += 1;
        if (user.trial_requested_at && (!gameData.lastRequest || user.trial_requested_at > gameData.lastRequest)) {
          gameData.lastRequest = user.trial_requested_at;
        }
        
        if (!connectionsMap.has(connection)) {
          connectionsMap.set(connection, { connection, count: 0 });
        }
        connectionsMap.get(connection).count += 1;
      });
      
      const games = Array.from(gamesMap.values())
        .sort((a, b) => b.count - a.count);
      
      const connections = Array.from(connectionsMap.values())
        .sort((a, b) => b.count - a.count);
      
      console.log(`✅ Estadísticas de juegos obtenidas: ${games.length} juegos, ${connections.length} conexiones`);
      return { games, connections };
    } catch (error) {
      console.error('❌ Error en getGamesStatistics:', error);
      return { games: [], connections: [] };
    }
  }
};

module.exports = db;
