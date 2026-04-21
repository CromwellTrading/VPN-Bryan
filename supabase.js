const { createClient } = require('@supabase/supabase-js');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Error: Faltan variables de entorno SUPABASE_URL o SUPABASE_KEY/SUPABASE_ANON_KEY');
  process.exit(1);
}

// Cliente para operaciones normales (usando anon key) - solo para lecturas públicas si se requiere
const supabase = createClient(supabaseUrl, supabaseKey);

// Cliente para operaciones de administración (usando service role key) - evita RLS
const supabaseAdmin = supabaseServiceKey ? createClient(supabaseUrl, supabaseServiceKey) : supabase;

if (!supabaseServiceKey) {
  console.warn('⚠️ SUPABASE_SERVICE_ROLE_KEY no configurada. Usando anon key para admin. Algunas operaciones pueden fallar por RLS.');
}

// Helper para usar supabaseAdmin en todas las operaciones de tablas (lectura/escritura)
// De esta forma nos aseguramos de que el backend tenga acceso total.
const dbClient = supabaseAdmin;

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

  async uploadPlanFile(fileBuffer, plan, originalFileName, useTimestamp = true) {
    try {
      console.log(`📤 Subiendo archivo para plan ${plan}: ${originalFileName}`);
      
      // Determinar el bucket según el plan
      const bucket = plan === 'trial' ? 'trial-files' : 'plan-files';
      
      // Determinar content type
      const extension = path.extname(originalFileName).toLowerCase();
      let contentType = 'application/octet-stream';
      if (extension === '.conf') contentType = 'text/plain';
      if (extension === '.zip') contentType = 'application/zip';
      if (extension === '.rar') contentType = 'application/x-rar-compressed';
      if (extension === '.txt') contentType = 'text/plain';
      
      // Para todos los archivos usar siempre el nombre original
      // El admin garantiza que cada archivo tiene nombre único
      const storageFileName = originalFileName;
      
      console.log(`📁 Nombre del archivo en storage: ${storageFileName}, bucket: ${bucket}`);
      
      // Usar el cliente admin para evitar problemas de RLS
      const { data, error } = await supabaseAdmin.storage
        .from(bucket)
        .upload(storageFileName, fileBuffer, {
          contentType: contentType,
          cacheControl: '3600',
          upsert: true // Permitir sobreescribir si el admin sube el mismo archivo nuevamente
        });

      if (error) {
        console.error('❌ Error subiendo archivo de plan:', error);
        throw error;
      }

      const { data: { publicUrl } } = supabaseAdmin.storage
        .from(bucket)
        .getPublicUrl(storageFileName);

      console.log(`✅ Archivo de plan subido: ${publicUrl}`);
      return {
        filename: storageFileName,
        publicUrl: publicUrl,
        originalName: originalFileName
      };

    } catch (error) {
      console.error('❌ Error en uploadPlanFile:', error);
      throw error;
    }
  },

  async deleteOldPlanFile(oldFileName) {
    try {
      if (!oldFileName) return;
      
      // Solo eliminar si existe el archivo antiguo
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
      
      const userId = String(telegramId).trim();
      
      const { data, error } = await dbClient
        .from('users')
        .select('*')
        .eq('telegram_id', userId)
        .single();
      
      if (error && error.code === 'PGRST116') {
        console.log(`📭 Usuario ${userId} no encontrado`);
        return null;
      }
      
      if (error) {
        console.error('❌ Error obteniendo usuario:', error.message);
        return null;
      }
      
      console.log(`✅ Usuario encontrado: ${data.first_name || data.username || userId}`);
      return data;
    } catch (error) {
      console.error('❌ Error en getUser:', error);
      return null;
    }
  },

  async saveUser(telegramId, userData) {
    try {
      console.log(`💾 Guardando usuario ${telegramId}...`);
      
      const userId = String(telegramId).trim();
      
      const existingUser = await this.getUser(userId);
      
      if (existingUser) {
        console.log(`✏️ Actualizando usuario existente ${userId}`);
        
        const updateData = {
          ...userData,
          updated_at: new Date().toISOString(),
          last_activity: new Date().toISOString()
        };
        
        updateData.telegram_id = userId;
        
        if (userData.trial_requested && !existingUser.trial_requested) {
          updateData.trial_requested_at = new Date().toISOString();
        }
        
        if (userData.trial_received && !existingUser.trial_received) {
          updateData.trial_sent_at = new Date().toISOString();
        }
        
        if (userData.referrer_id && !existingUser.referrer_id) {
          updateData.referrer_id = userData.referrer_id;
          updateData.referrer_username = userData.referrer_username;
        }
        
        if (userData.is_active === undefined) {
          updateData.is_active = existingUser.is_active;
        }
        
        const { data, error } = await dbClient
          .from('users')
          .update(updateData)
          .eq('telegram_id', userId)
          .select()
          .single();
        
        if (error) {
          console.error('❌ Error actualizando usuario:', error);
          throw error;
        }
        
        console.log(`✅ Usuario actualizado: ${data.first_name || data.username || userId}`);
        return data;
      } else {
        console.log(`🆕 Creando nuevo usuario ${userId}`);
        
        const insertData = {
          telegram_id: userId,
          ...userData,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          last_activity: new Date().toISOString()
        };
        
        if (insertData.is_active === undefined) {
          insertData.is_active = true;
        }
        
        const { data, error } = await dbClient
          .from('users')
          .insert([insertData])
          .select()
          .single();
        
        if (error) {
          console.error('❌ Error creando usuario:', error);
          throw error;
        }
        
        console.log(`✅ Usuario creado: ${data.first_name || data.username || userId}`);
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
      
      const userId = String(telegramId).trim();
      
      const { data, error } = await dbClient
        .from('users')
        .update({
          ...updateData,
          telegram_id: userId,
          updated_at: new Date().toISOString()
        })
        .eq('telegram_id', userId)
        .select()
        .single();
      
      if (error) {
        console.error('❌ Error actualizando usuario:', error);
        throw error;
      }
      
      console.log(`✅ Usuario ${userId} actualizado`);
      return data;
    } catch (error) {
      console.error('❌ Error actualizando usuario:', error);
      throw error;
    }
  },

  async updateUserActiveStatus(telegramId, isActive, lastError = null) {
    try {
      console.log(`✏️ Actualizando estado activo para usuario ${telegramId}: ${isActive}`);
      
      const updateData = {
        is_active: isActive,
        updated_at: new Date().toISOString()
      };
      
      if (lastError) {
        updateData.last_error = lastError;
      }
      
      return await this.updateUser(telegramId, updateData);
    } catch (error) {
      console.error('❌ Error actualizando estado activo:', error);
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
      
      const userId = String(telegramId).trim();
      
      const { data, error } = await dbClient
        .from('users')
        .update({
          telegram_id: userId,
          vip: true,
          plan: vipData.plan || 'vip',
          plan_price: vipData.plan_price || 0,
          vip_since: vipData.vip_since || new Date().toISOString(),
          updated_at: new Date().toISOString(),
          payment_method: vipData.payment_method || null
        })
        .eq('telegram_id', userId)
        .select()
        .single();
      
      if (error) {
        console.error('❌ Error haciendo usuario VIP:', error);
        throw error;
      }
      
      console.log(`✅ Usuario ${userId} marcado como VIP`);
      return data;
    } catch (error) {
      console.error('❌ Error haciendo usuario VIP:', error);
      throw error;
    }
  },

  async removeVIP(telegramId) {
    try {
      console.log(`👑 Removiendo VIP de usuario ${telegramId}...`);
      
      const userId = String(telegramId).trim();
      
      const { data, error } = await dbClient
        .from('users')
        .update({
          telegram_id: userId,
          vip: false,
          plan: null,
          plan_price: null,
          vip_since: null,
          updated_at: new Date().toISOString()
        })
        .eq('telegram_id', userId)
        .select()
        .single();
      
      if (error) {
        console.error('❌ Error removiendo VIP:', error);
        throw error;
      }
      
      console.log(`✅ VIP removido de usuario ${userId}`);
      return data;
    } catch (error) {
      console.error('❌ Error removiendo VIP:', error);
      throw error;
    }
  },

  async getAllUsers() {
    try {
      console.log('👥 Obteniendo todos los usuarios (paginación automática)...');
      
      let allUsers = [];
      let from = 0;
      const pageSize = 1000;

      while (true) {
        const { data, error } = await dbClient
          .from('users')
          .select('*')
          .order('created_at', { ascending: false })
          .range(from, from + pageSize - 1);

        if (error) {
          console.error('❌ Error obteniendo usuarios:', error);
          throw error;
        }

        if (data && data.length > 0) {
          allUsers = allUsers.concat(data);
          from += pageSize;
          if (data.length < pageSize) break;
        } else {
          break;
        }
      }

      console.log(`✅ Total de usuarios obtenidos: ${allUsers.length}`);
      return allUsers;
    } catch (error) {
      console.error('❌ Error en getAllUsers:', error);
      return [];
    }
  },

  async getVIPUsers() {
    try {
      console.log('👑 Obteniendo usuarios VIP...');
      
      const { data, error } = await dbClient
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
      
      const { data, error } = await dbClient
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
      
      const referrerIdStr = String(referrerId).trim();
      const referredIdStr = String(referredId).trim();
      
      // Verificar si ya existe este referido
      const { data: existing, error: checkError } = await dbClient
        .from('referrals')
        .select('id')
        .eq('referrer_id', referrerIdStr)
        .eq('referred_id', referredIdStr)
        .single();
      
      if (existing) {
        console.log(`✅ Referido ya existe`);
        return existing;
      }
      
      // Crear nuevo referido (Nivel 1)
      const { data, error } = await dbClient
        .from('referrals')
        .insert([{
          referrer_id: referrerIdStr,
          referred_id: referredIdStr,
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
      const { data: referrerReferrals } = await dbClient
        .from('referrals')
        .select('referrer_id')
        .eq('referred_id', referrerIdStr)
        .eq('level', 1)
        .single();
      
      if (referrerReferrals && referrerReferrals.referrer_id) {
        await dbClient
          .from('referrals')
          .insert([{
            referrer_id: referrerReferrals.referrer_id,
            referred_id: referredIdStr,
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
      
      const userId = String(telegramId).trim();
      
      const { data: level1, error: error1 } = await dbClient
        .from('referrals')
        .select('*')
        .eq('referrer_id', userId)
        .eq('level', 1);
      
      if (error1) {
        console.error('❌ Error obteniendo referidos nivel 1:', error1);
        return {
          level1: { total: 0, paid: 0 },
          level2: { total: 0, paid: 0 },
          total_referrals: 0,
          total_paid: 0,
          discount_percentage: 0,
          paid_referrals: 0
        };
      }
      
      const { data: level2, error: error2 } = await dbClient
        .from('referrals')
        .select('*')
        .eq('referrer_id', userId)
        .eq('level', 2);
      
      if (error2) {
        console.error('❌ Error obteniendo referidos nivel 2:', error2);
        return {
          level1: { total: level1?.length || 0, paid: 0 },
          level2: { total: 0, paid: 0 },
          total_referrals: level1?.length || 0,
          total_paid: 0,
          discount_percentage: 0,
          paid_referrals: 0
        };
      }
      
      const level1Paid = level1?.filter(r => r.has_paid).length || 0;
      const level2Paid = level2?.filter(r => r.has_paid).length || 0;
      const totalReferrals = (level1?.length || 0) + (level2?.length || 0);
      const totalPaid = level1Paid + level2Paid;
      
      const discount = (level1Paid * 20) + (level2Paid * 10);
      const discountPercentage = discount > 100 ? 100 : discount;
      
      return {
        level1: {
          total: level1?.length || 0,
          paid: level1Paid
        },
        level2: {
          total: level2?.length || 0,
          paid: level2Paid
        },
        total_referrals: totalReferrals,
        total_paid: totalPaid,
        discount_percentage: discountPercentage,
        paid_referrals: totalPaid
      };
      
    } catch (error) {
      console.error('❌ Error obteniendo estadísticas de referidos:', error);
      return {
        level1: { total: 0, paid: 0 },
        level2: { total: 0, paid: 0 },
        total_referrals: 0,
        total_paid: 0,
        discount_percentage: 0,
        paid_referrals: 0
      };
    }
  },

  async getAllReferralsStats() {
    try {
      console.log('📊 Obteniendo estadísticas generales de referidos');
      
      const { data: referrals, error } = await dbClient
        .from('referrals')
        .select('*');
      
      if (error) {
        console.error('❌ Error obteniendo todos los referidos:', error);
        return {
          total_referrals: 0,
          total_paid: 0,
          top_referrers: [],
          recent_referrals: [],
          paid_referrals: 0,
          level1_referrals: 0,
          level2_referrals: 0,
          paid_level1: 0,
          paid_level2: 0
        };
      }
      
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
      
      const topReferrers = Array.from(referrersMap.values())
        .sort((a, b) => b.total - a.total)
        .slice(0, 10);
      
      const recentReferrals = referrals
        ?.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, 10) || [];
      
      const total_referrals = referrals?.length || 0;
      const total_paid = referrals?.filter(r => r.has_paid).length || 0;
      const level1_referrals = referrals?.filter(r => r.level === 1).length || 0;
      const level2_referrals = referrals?.filter(r => r.level === 2).length || 0;
      const paid_level1 = referrals?.filter(r => r.level === 1 && r.has_paid).length || 0;
      const paid_level2 = referrals?.filter(r => r.level === 2 && r.has_paid).length || 0;
      
      return {
        total_referrals: total_referrals,
        total_paid: total_paid,
        top_referrers: topReferrers,
        recent_referrals: recentReferrals,
        paid_referrals: total_paid,
        level1_referrals: level1_referrals,
        level2_referrals: level2_referrals,
        paid_level1: paid_level1,
        paid_level2: paid_level2
      };
      
    } catch (error) {
      console.error('❌ Error en getAllReferralsStats:', error);
      return {
        total_referrals: 0,
        total_paid: 0,
        top_referrers: [],
        recent_referrals: [],
        paid_referrals: 0,
        level1_referrals: 0,
        level2_referrals: 0,
        paid_level1: 0,
        paid_level2: 0
      };
    }
  },

  async markReferralAsPaid(referredId, level = 1) {
    try {
      console.log(`💰 Marcando referido ${referredId} como pagado (nivel ${level})`);
      
      const userId = String(referredId).trim();
      
      const { data, error } = await dbClient
        .from('referrals')
        .update({ has_paid: true })
        .eq('referred_id', userId)
        .select();
      
      if (error) {
        console.error('❌ Error marcando referido como pagado:', error);
        throw error;
      }
      
      console.log(`✅ Referido ${userId} marcado como pagado`);
      return data;
    } catch (error) {
      console.error('❌ Error en markReferralAsPaid:', error);
      throw error;
    }
  },

  async getReferralsByReferrer(referrerId) {
    try {
      console.log(`🔍 Obteniendo referidos de ${referrerId}`);
      
      const userId = String(referrerId).trim();
      
      const { data, error } = await dbClient
        .from('referrals')
        .select('*')
        .eq('referrer_id', userId)
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
        status: paymentData.status,
        coupon_used: paymentData.coupon_used,
        coupon_code: paymentData.coupon_code,
        original_price: paymentData.original_price
      });
      
      if (!paymentData.telegram_id || paymentData.telegram_id === 'undefined' || paymentData.telegram_id === 'null') {
        console.error('❌ Error: El campo telegram_id es inválido:', paymentData.telegram_id);
        throw new Error('El campo telegram_id es requerido y debe ser válido para crear un pago');
      }
      
      const telegramId = String(paymentData.telegram_id).trim();
      
      const { data, error } = await dbClient
        .from('payments')
        .insert([{
          telegram_id: telegramId,
          plan: paymentData.plan,
          price: paymentData.price,
          original_price: paymentData.original_price || paymentData.price,
          method: paymentData.method || 'transfer',
          screenshot_url: paymentData.screenshot_url || '',
          notes: paymentData.notes || '',
          status: paymentData.status || 'pending',
          coupon_used: paymentData.coupon_used || false,
          coupon_code: paymentData.coupon_code || null,
          coupon_discount: paymentData.coupon_discount || 0,
          created_at: paymentData.created_at || new Date().toISOString(),
          updated_at: new Date().toISOString()
        }])
        .select()
        .single();
      
      if (error) {
        console.error('❌ Error creando pago:', error);
        throw error;
      }
      
      console.log(`✅ Pago creado con ID: ${data.id}, telegram_id: ${data.telegram_id}, cupón: ${data.coupon_code || 'No aplicado'}`);
      return data;
    } catch (error) {
      console.error('❌ Error creando pago:', error);
      throw error;
    }
  },

  async getPayment(paymentId) {
    try {
      console.log(`🔍 Buscando pago ${paymentId}...`);
      
      const { data, error } = await dbClient
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
      
      console.log(`✅ Pago ${paymentId} encontrado, telegram_id: ${data.telegram_id || 'NO TIENE'}, cupón: ${data.coupon_code || 'No'}`);
      
      if (!data.telegram_id) {
        console.warn(`⚠️ ADVERTENCIA: El pago ${paymentId} no tiene telegram_id`);
      } else {
        data.telegram_id = String(data.telegram_id).trim();
      }
      
      return data;
    } catch (error) {
      console.error('❌ Error obteniendo pago:', error);
      return null;
    }
  },

  async getPendingPayments() {
    try {
      console.log('🔍 Buscando pagos pendientes...');
      
      const { data, error } = await dbClient
        .from('payments')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      
      if (error) {
        console.error('❌ Error obteniendo pagos pendientes:', error);
        throw error;
      }
      
      console.log(`✅ ${data?.length || 0} pagos pendientes encontrados`);
      
      const pagosSinTelegramId = data?.filter(p => !p.telegram_id) || [];
      if (pagosSinTelegramId.length > 0) {
        console.warn(`⚠️ ADVERTENCIA: ${pagosSinTelegramId.length} pagos pendientes no tienen telegram_id`);
      }
      
      const processedData = data?.map(payment => ({
        ...payment,
        telegram_id: payment.telegram_id ? String(payment.telegram_id).trim() : null
      })) || [];
      
      return processedData;
    } catch (error) {
      console.error('❌ Error obteniendo pagos pendientes:', error);
      return [];
    }
  },

  async getApprovedPayments() {
    try {
      console.log('🔍 Buscando pagos aprobados...');
      
      const { data, error } = await dbClient
        .from('payments')
        .select('*')
        .eq('status', 'approved')
        .order('created_at', { ascending: false });
      
      if (error) {
        console.error('❌ Error obteniendo pagos aprobados:', error);
        throw error;
      }
      
      console.log(`✅ ${data?.length || 0} pagos aprobados encontrados`);
      
      const pagosSinTelegramId = data?.filter(p => !p.telegram_id) || [];
      if (pagosSinTelegramId.length > 0) {
        console.warn(`⚠️ ADVERTENCIA: ${pagosSinTelegramId.length} pagos aprobados no tienen telegram_id`);
      }
      
      const processedData = data?.map(payment => ({
        ...payment,
        telegram_id: payment.telegram_id ? String(payment.telegram_id).trim() : null
      })) || [];
      
      return processedData;
    } catch (error) {
      console.error('❌ Error obteniendo pagos aprobados:', error);
      return [];
    }
  },

  async approvePayment(paymentId) {
    try {
      console.log(`✅ Aprobando pago ${paymentId}...`);
      
      const { data, error } = await dbClient
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
      
      if (data.telegram_id) {
        data.telegram_id = String(data.telegram_id).trim();
      }
      
      console.log(`✅ Pago ${paymentId} aprobado, telegram_id: ${data.telegram_id || 'NO TIENE'}, cupón: ${data.coupon_code || 'No'}`);
      return data;
    } catch (error) {
      console.error('❌ Error aprobando pago:', error);
      throw error;
    }
  },

  async rejectPayment(paymentId, reason) {
    try {
      console.log(`❌ Rechazando pago ${paymentId} con motivo: ${reason}`);
      
      const { data, error } = await dbClient
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
      
      const { data, error } = await dbClient
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
      
      const userId = String(telegramId).trim();
      
      const { data, error } = await dbClient
        .from('payments')
        .select('*')
        .eq('telegram_id', userId)
        .order('created_at', { ascending: false });
      
      if (error) {
        console.error('❌ Error obteniendo pagos del usuario:', error);
        throw error;
      }
      
      console.log(`✅ ${data?.length || 0} pagos encontrados para usuario ${userId}`);
      return data || [];
    } catch (error) {
      console.error('❌ Error obteniendo pagos del usuario:', error);
      return [];
    }
  },

  // ========== PAGOS USDT ==========
  async createUsdtPayment(usdtData) {
    try {
      console.log('💸 Creando pago USDT (registro manual)...', {
        telegram_id: usdtData.telegram_id,
        plan: usdtData.plan,
        usdt_amount: usdtData.usdt_amount
      });
      
      const { data, error } = await dbClient
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
      
      console.log(`✅ Pago USDT creado con ID: ${data.id} (requiere aprobación manual)`);
      return data;
    } catch (error) {
      console.error('❌ Error creando pago USDT:', error);
      throw error;
    }
  },

  async getUsdtPaymentByAddress(address) {
    try {
      console.log(`🔍 Buscando pago USDT con dirección: ${address}`);
      
      const { data, error } = await dbClient
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

  async updateUsdtPaymentStatus(address, status, transactionHash = null, sender = null) {
    try {
      console.log(`✏️ Actualizando pago USDT ${address} a ${status} (MANUAL)`);
      
      const updateData = {
        status: status,
        updated_at: new Date().toISOString()
      };
      
      if (transactionHash) {
        updateData.transaction_hash = transactionHash;
      }
      
      if (sender) {
        updateData.sender_address = sender;
      }
      
      if (status === 'completed') {
        updateData.completed_at = new Date().toISOString();
      }
      
      const { data, error } = await dbClient
        .from('usdt_payments')
        .update(updateData)
        .eq('usdt_address', address)
        .select()
        .single();
      
      if (error) {
        console.error('❌ Error actualizando pago USDT:', error);
        throw error;
      }
      
      console.log(`✅ Pago USDT actualizado manualmente`);
      return data;
    } catch (error) {
      console.error('❌ Error actualizando pago USDT:', error);
      throw error;
    }
  },

  // ========== ARCHIVOS DE PLANES ==========
  async savePlanFile(planFileData) {
    try {
      console.log(`💾 Guardando información de archivo de plan...`);
      
      const { data: existing } = await dbClient
        .from('plan_files')
        .select('*')
        .eq('plan', planFileData.plan)
        .single();
      
      if (existing) {
        if (planFileData.plan === 'trial' && existing.storage_filename) {
          const { error: deleteError } = await supabaseAdmin.storage
            .from('trial-files')
            .remove([existing.storage_filename]);
          
          if (deleteError) {
            console.error('❌ Error eliminando archivo de prueba anterior:', deleteError);
          } else {
            console.log(`✅ Archivo de prueba anterior eliminado: ${existing.storage_filename}`);
          }
        }
        
        const { data, error } = await dbClient
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
        const { data, error } = await dbClient
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
      
      const { data, error } = await dbClient
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
      
      const { data, error } = await dbClient
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
        const bucket = plan === 'trial' ? 'trial-files' : 'plan-files';
        
        const { error: deleteError } = await supabaseAdmin.storage
          .from(bucket)
          .remove([fileData.storage_filename]);
        
        if (deleteError) {
          console.error('❌ Error eliminando archivo de storage:', deleteError);
        } else {
          console.log(`✅ Archivo eliminado de storage: ${fileData.storage_filename} (bucket: ${bucket})`);
        }
      }
      
      const { data, error } = await dbClient
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
      
      const { data: usersData, error: usersError } = await dbClient
        .from('users')
        .select('vip, created_at, trial_requested, trial_received, referrer_id, referrer_username, is_active');
      
      if (usersError) {
        console.error('❌ Error obteniendo usuarios para estadísticas:', usersError);
        throw usersError;
      }
      
      const totalUsers = usersData?.length || 0;
      const vipUsers = usersData?.filter(u => u.vip)?.length || 0;
      const trialRequests = usersData?.filter(u => u.trial_requested)?.length || 0;
      const trialReceived = usersData?.filter(u => u.trial_received)?.length || 0;
      const usersWithReferrer = usersData?.filter(u => u.referrer_id)?.length || 0;
      const activeUsers = usersData?.filter(u => u.is_active !== false)?.length || 0;
      const inactiveUsers = usersData?.filter(u => u.is_active === false)?.length || 0;
      
      const { data: paymentsData, error: paymentsError } = await dbClient
        .from('payments')
        .select('status, price, method, telegram_id, coupon_used, coupon_code, coupon_discount');
      
      if (paymentsError) {
        console.error('❌ Error obteniendo pagos para estadísticas:', paymentsError);
        throw paymentsError;
      }
      
      const totalPayments = paymentsData?.length || 0;
      const pendingPayments = paymentsData?.filter(p => p.status === 'pending')?.length || 0;
      const approvedPayments = paymentsData?.filter(p => p.status === 'approved')?.length || 0;
      const rejectedPayments = paymentsData?.filter(p => p.status === 'rejected')?.length || 0;
      const usdtPayments = paymentsData?.filter(p => p.method === 'usdt')?.length || 0;
      const couponPayments = paymentsData?.filter(p => p.coupon_used)?.length || 0;
      
      const totalRevenue = paymentsData
        ?.filter(p => p.status === 'approved' && p.price)
        ?.reduce((sum, p) => sum + (parseFloat(p.price) || 0), 0) || 0;
      
      const totalDiscounts = paymentsData
        ?.filter(p => p.status === 'approved' && p.coupon_discount && p.price)
        ?.reduce((sum, p) => {
          const originalPrice = p.original_price || p.price / (1 - (p.coupon_discount / 100));
          const discountAmount = originalPrice - parseFloat(p.price);
          return sum + discountAmount;
        }, 0) || 0;
      
      const referralsStats = await this.getAllReferralsStats();
      
      const { data: usdtData } = await dbClient
        .from('usdt_payments')
        .select('status');
      
      const totalUsdtPayments = usdtData?.length || 0;
      const pendingUsdt = usdtData?.filter(p => p.status === 'pending')?.length || 0;
      const completedUsdt = usdtData?.filter(p => p.status === 'completed')?.length || 0;
      
      const { data: broadcastsData } = await dbClient
        .from('broadcasts')
        .select('status');
      
      const totalBroadcasts = broadcastsData?.length || 0;
      const completedBroadcasts = broadcastsData?.filter(b => b.status === 'completed')?.length || 0;
      
      const couponsStats = await this.getCouponsStats();
      
      return {
        users: {
          total: totalUsers,
          vip: vipUsers,
          regular: totalUsers - vipUsers,
          trial_requests: trialRequests,
          trial_received: trialReceived,
          trial_pending: trialRequests - trialReceived,
          with_referrer: usersWithReferrer,
          active: activeUsers,
          inactive: inactiveUsers
        },
        payments: {
          total: totalPayments,
          pending: pendingPayments,
          approved: approvedPayments,
          rejected: rejectedPayments,
          usdt: usdtPayments,
          with_coupon: couponPayments
        },
        revenue: {
          total: totalRevenue,
          discounts: totalDiscounts,
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
        },
        coupons: couponsStats
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
          with_referrer: 0,
          active: 0,
          inactive: 0
        },
        payments: { 
          total: 0, 
          pending: 0, 
          approved: 0, 
          rejected: 0,
          usdt: 0,
          with_coupon: 0
        },
        revenue: { 
          total: 0, 
          discounts: 0,
          average: 0
        },
        referrals: {
          total_referrals: 0,
          total_paid: 0,
          top_referrers: [],
          recent_referrals: [],
          paid_referrals: 0,
          level1_referrals: 0,
          level2_referrals: 0,
          paid_level1: 0,
          paid_level2: 0
        },
        usdt: {
          total: 0,
          pending: 0,
          completed: 0
        },
        broadcasts: {
          total: 0,
          completed: 0
        },
        coupons: {
          total: 0,
          active: 0,
          expired: 0,
          used: 0,
          coupons: []
        }
      };
    }
  },

  // ========== FUNCIONES DE PRUEBA GRATUITA ==========
  async getTrialStats() {
    try {
      console.log('🎯 Obteniendo estadísticas de pruebas...');
      
      const { data, error } = await dbClient
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
      
      const today = new Date().toISOString().split('T')[0];
      const todayRequests = data?.filter(u => 
        u.trial_requested_at && u.trial_requested_at.startsWith(today)
      )?.length || 0;
      
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
      
      const { data, error } = await dbClient
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
      
      const userId = String(telegramId).trim();
      
      const { data, error } = await dbClient
        .from('users')
        .update({
          trial_received: true,
          trial_sent_at: new Date().toISOString(),
          trial_sent_by: sentBy,
          updated_at: new Date().toISOString()
        })
        .eq('telegram_id', userId)
        .select()
        .single();
      
      if (error) {
        console.error('❌ Error marcando prueba como enviada:', error);
        throw error;
      }
      
      console.log(`✅ Prueba marcada como enviada para ${userId}`);
      return data;
    } catch (error) {
      console.error('❌ Error en markTrialAsSent:', error);
      throw error;
    }
  },

  async checkTrialEligibility(telegramId) {
    try {
      console.log(`🔍 Verificando elegibilidad para prueba de ${telegramId}...`);
      
      const userId = String(telegramId).trim();
      const user = await this.getUser(userId);
      
      if (!user) {
        return {
          eligible: true,
          reason: 'Nuevo usuario'
        };
      }
      
      if (!user.trial_requested) {
        return {
          eligible: true,
          reason: 'Primera solicitud'
        };
      }
      
      if (user.trial_requested && !user.trial_received) {
        return {
          eligible: false,
          reason: 'Ya tiene una solicitud pendiente'
        };
      }
      
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
      
      const { data, error } = await dbClient
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
      
      const { data, error } = await dbClient
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
      
      const { data, error } = await dbClient
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
        updateData.unavailable_count = stats.unavailable_count || 0;
      } else if (status === 'sending') {
        updateData.sent_count = stats.sent_count || 0;
        updateData.total_users = stats.total_users || 0;
        updateData.failed_count = stats.failed_count || 0;
        updateData.unavailable_count = stats.unavailable_count || 0;
      }
      
      const { data, error } = await dbClient
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
      
      let query = dbClient
        .from('users')
        .select('telegram_id, username, first_name, vip, trial_requested, trial_received, last_activity, is_active');
      
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

  async retryFailedBroadcast(broadcastId) {
    try {
      console.log(`🔄 Reintentando broadcast fallido: ${broadcastId}`);
      
      const { data, error } = await dbClient
        .from('broadcasts')
        .update({
          status: 'pending',
          updated_at: new Date().toISOString()
        })
        .eq('id', broadcastId)
        .select()
        .single();
      
      if (error) {
        console.error('❌ Error reintentando broadcast:', error);
        throw error;
      }
      
      console.log(`✅ Broadcast ${broadcastId} marcado para reintento`);
      return data;
    } catch (error) {
      console.error('❌ Error en retryFailedBroadcast:', error);
      throw error;
    }
  },

  // ========== CUPONES ==========
  async createCoupon(couponData) {
    try {
      console.log(`🎫 CREANDO CUPÓN EN DB: ${couponData.code}`);
      console.log(`📊 Datos del cupón:`, JSON.stringify(couponData, null, 2));
      
      const { data, error } = await dbClient
        .from('coupons')
        .insert([{
          code: couponData.code,
          discount: couponData.discount,
          stock: couponData.stock,
          expiry: couponData.expiry || null,
          description: couponData.description || '',
          status: couponData.status || 'active',
          used: 0,
          created_by: couponData.created_by || 'system',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }])
        .select()
        .single();
      
      if (error) {
        console.error('❌ ERROR EN QUERY SUPABASE:', error);
        throw error;
      }
      
      console.log(`✅ CUPÓN CREADO EN DB: ${data.code}`);
      return data;
    } catch (error) {
      console.error('❌ ERROR EN createCoupon:', error);
      throw error;
    }
  },

  async getCoupons() {
    try {
      console.log('🎫 Obteniendo todos los cupones...');
      
      const { data, error } = await dbClient
        .from('coupons')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) {
        console.error('❌ Error obteniendo cupones:', error);
        throw error;
      }
      
      console.log(`✅ ${data?.length || 0} cupones encontrados`);
      return data || [];
    } catch (error) {
      console.error('❌ Error en getCoupons:', error);
      return [];
    }
  },

  async getCoupon(code) {
    try {
      console.log(`🔍 Buscando cupón: ${code}`);
      
      const { data, error } = await dbClient
        .from('coupons')
        .select('*')
        .eq('code', code.toUpperCase())
        .single();
      
      if (error && error.code === 'PGRST116') {
        console.log(`📭 Cupón ${code} no encontrado`);
        return null;
      }
      
      if (error) {
        console.error('❌ Error obteniendo cupón:', error);
        throw error;
      }
      
      console.log(`✅ Cupón encontrado: ${data.code}`);
      return data;
    } catch (error) {
      console.error('❌ Error en getCoupon:', error);
      return null;
    }
  },

  async getCouponsStats() {
    try {
      console.log('📊 Obteniendo estadísticas de cupones...');
      
      const { data, error } = await dbClient
        .from('coupons')
        .select('*');
      
      if (error) {
        console.error('❌ Error obteniendo cupones para estadísticas:', error);
        throw error;
      }
      
      const total = data?.length || 0;
      const active = data?.filter(c => c.status === 'active').length || 0;
      const expired = data?.filter(c => c.status === 'expired').length || 0;
      const inactive = data?.filter(c => c.status === 'inactive').length || 0;
      const used = data?.reduce((sum, c) => sum + (c.used || 0), 0);
      
      const averageDiscount = data?.length > 0 ? 
        data.reduce((sum, c) => sum + (c.discount || 0), 0) / data.length : 0;
      
      const lowStock = data?.filter(c => c.stock < 5 && c.stock > 0).length || 0;
      const outOfStock = data?.filter(c => c.stock === 0).length || 0;
      
      return {
        total: total,
        active: active,
        expired: expired,
        inactive: inactive,
        used: used,
        average_discount: averageDiscount.toFixed(1),
        low_stock: lowStock,
        out_of_stock: outOfStock,
        coupons: data || []
      };
    } catch (error) {
      console.error('❌ Error en getCouponsStats:', error);
      return {
        total: 0,
        active: 0,
        expired: 0,
        inactive: 0,
        used: 0,
        average_discount: 0,
        low_stock: 0,
        out_of_stock: 0,
        coupons: []
      };
    }
  },

  async updateCoupon(code, updateData) {
    try {
      console.log(`✏️ Actualizando cupón: ${code}`);
      
      const { data, error } = await dbClient
        .from('coupons')
        .update({
          ...updateData,
          updated_at: new Date().toISOString()
        })
        .eq('code', code.toUpperCase())
        .select()
        .single();
      
      if (error) {
        console.error('❌ Error actualizando cupón:', error);
        throw error;
      }
      
      console.log(`✅ Cupón actualizado: ${data.code}`);
      return data;
    } catch (error) {
      console.error('❌ Error en updateCoupon:', error);
      throw error;
    }
  },

  async updateCouponStatus(code, status, updatedBy) {
    try {
      console.log(`✏️ Actualizando estado del cupón ${code} a ${status}`);
      
      const { data, error } = await dbClient
        .from('coupons')
        .update({
          status: status,
          updated_by: updatedBy,
          updated_at: new Date().toISOString()
        })
        .eq('code', code.toUpperCase())
        .select()
        .single();
      
      if (error) {
        console.error('❌ Error actualizando estado del cupón:', error);
        throw error;
      }
      
      console.log(`✅ Estado del cupón actualizado: ${data.code} -> ${data.status}`);
      return data;
    } catch (error) {
      console.error('❌ Error en updateCouponStatus:', error);
      throw error;
    }
  },

  async deleteCoupon(code) {
    try {
      console.log(`🗑️ Eliminando cupón: ${code}`);
      
      const { data, error } = await dbClient
        .from('coupons')
        .delete()
        .eq('code', code.toUpperCase())
        .select()
        .single();
      
      if (error) {
        console.error('❌ Error eliminando cupón:', error);
        throw error;
      }
      
      console.log(`✅ Cupón eliminado: ${code}`);
      return data;
    } catch (error) {
      console.error('❌ Error en deleteCoupon:', error);
      throw error;
    }
  },

  async hasUserUsedCoupon(telegramId, code) {
    try {
      console.log(`🔍 Verificando si usuario ${telegramId} usó el cupón ${code}`);
      
      const userId = String(telegramId).trim();
      const couponCode = code.toUpperCase();
      
      const { data, error } = await dbClient
        .from('coupon_usage')
        .select('id')
        .eq('telegram_id', userId)
        .eq('coupon_code', couponCode)
        .single();
      
      if (error && error.code === 'PGRST116') {
        console.log(`✅ Usuario ${userId} no ha usado el cupón ${couponCode}`);
        return false;
      }
      
      if (error) {
        console.error('❌ Error verificando uso de cupón:', error);
        throw error;
      }
      
      console.log(`✅ Usuario ${userId} ya usó el cupón ${couponCode}`);
      return true;
    } catch (error) {
      console.error('❌ Error en hasUserUsedCoupon:', error);
      return false;
    }
  },

  async applyCouponToPayment(code, telegramId, paymentId) {
    try {
      console.log(`🎫 Aplicando cupón ${code} al pago ${paymentId} del usuario ${telegramId}`);
      
      const userId = String(telegramId).trim();
      const couponCode = code.toUpperCase();
      
      const coupon = await this.getCoupon(couponCode);
      if (!coupon || coupon.status !== 'active') {
        throw new Error('Cupón no válido o inactivo');
      }
      
      if (coupon.stock <= 0) {
        throw new Error('Cupón agotado');
      }
      
      const hasUsed = await this.hasUserUsedCoupon(userId, couponCode);
      if (hasUsed) {
        throw new Error('Usuario ya usó este cupón');
      }
      
      const { data, error } = await dbClient
        .from('coupon_usage')
        .insert([{
          coupon_code: couponCode,
          telegram_id: userId,
          payment_id: paymentId,
          discount_applied: coupon.discount,
          used_at: new Date().toISOString()
        }])
        .select()
        .single();
      
      if (error) {
        console.error('❌ Error aplicando cupón al pago:', error);
        throw error;
      }
      
      await this.updateCoupon(couponCode, {
        stock: coupon.stock - 1,
        used: (coupon.used || 0) + 1,
        updated_at: new Date().toISOString(),
        updated_by: 'system'
      });
      
      console.log(`✅ Cupón aplicado: ${couponCode} -> pago ${paymentId}`);
      return data;
    } catch (error) {
      console.error('❌ Error en applyCouponToPayment:', error);
      throw error;
    }
  },

  async getCouponUsageHistory(code) {
    try {
      console.log(`📜 Obteniendo historial de uso del cupón: ${code}`);
      
      const couponCode = code.toUpperCase();
      
      const { data, error } = await dbClient
        .from('coupon_usage')
        .select(`
          *,
          payments:payment_id (
            id,
            plan,
            price,
            original_price,
            method,
            status,
            created_at
          ),
          users:telegram_id (
            telegram_id,
            username,
            first_name
          )
        `)
        .eq('coupon_code', couponCode)
        .order('used_at', { ascending: false });
      
      if (error) {
        console.error('❌ Error obteniendo historial de cupón:', error);
        throw error;
      }
      
      console.log(`✅ ${data?.length || 0} usos encontrados para el cupón ${couponCode}`);
      return data || [];
    } catch (error) {
      console.error('❌ Error en getCouponUsageHistory:', error);
      return [];
    }
  },

  // ========== FUNCIONES ADICIONALES ==========
  async searchUsers(searchTerm) {
    try {
      console.log(`🔍 Buscando usuarios con término: ${searchTerm}`);
      
      const { data, error } = await dbClient
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
      
      const { data, error } = await dbClient
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
      
      const { data: payments, error: paymentsError } = await dbClient
        .from('payments')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);
      
      if (paymentsError) {
        console.error('❌ Error obteniendo pagos recientes:', paymentsError);
        return [];
      }
      
      const { data: users, error: usersError } = await dbClient
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
          coupon_used: p.coupon_used,
          coupon_code: p.coupon_code,
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
          is_active: u.is_active,
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
      
      const { data, error } = await dbClient
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
  },

  async testDatabaseConnection() {
    try {
      console.log('🔍 Probando conexión a la base de datos...');
      
      const { data: users, error: usersError } = await dbClient
        .from('users')
        .select('count')
        .limit(1);
      
      const { data: payments, error: paymentsError } = await dbClient
        .from('payments')
        .select('count')
        .limit(1);
      
      const { data: usdtPayments, error: usdtError } = await dbClient
        .from('usdt_payments')
        .select('count')
        .limit(1);
      
      const { data: broadcasts, error: broadcastsError } = await dbClient
        .from('broadcasts')
        .select('count')
        .limit(1);
      
      const { data: coupons, error: couponsError } = await dbClient
        .from('coupons')
        .select('count')
        .limit(1);
      
      const storageStatus = await this.checkStorageAccess();
      
      return {
        users: usersError ? `Error: ${usersError.message}` : '✅ Conectado',
        payments: paymentsError ? `Error: ${paymentsError.message}` : '✅ Conectado',
        usdt_payments: usdtError ? `Error: ${usdtError.message}` : '✅ Conectado',
        broadcasts: broadcastsError ? `Error: ${broadcastsError.message}` : '✅ Conectado',
        coupons: couponsError ? `Error: ${couponsError.message}` : '✅ Conectado',
        storage: storageStatus
      };
    } catch (error) {
      console.error('❌ Error en testDatabaseConnection:', error);
      return {
        users: `Error: ${error.message}`,
        payments: 'No probado',
        usdt_payments: 'No probado',
        broadcasts: 'No probado',
        coupons: 'No probado',
        storage: []
      };
    }
  },

  async checkStorageAccess() {
    try {
      console.log('📦 Verificando acceso a storage...');
      
      const buckets = ['payments-screenshots', 'plan-files', 'trial-files'];
      const results = [];
      
      for (const bucket of buckets) {
        try {
          const { data, error } = await supabaseAdmin.storage
            .from(bucket)
            .list();
          
          if (error) {
            results.push({ bucket, status: `❌ Error: ${error.message}` });
          } else {
            results.push({ 
              bucket, 
              status: '✅ Acceso permitido',
              fileCount: data?.length || 0
            });
          }
        } catch (bucketError) {
          results.push({ bucket, status: `❌ Error: ${bucketError.message}` });
        }
      }
      
      return results;
    } catch (error) {
      console.error('❌ Error en checkStorageAccess:', error);
      return [{ bucket: 'general', status: `❌ Error: ${error.message}` }];
    }
  }
};

module.exports = db;
