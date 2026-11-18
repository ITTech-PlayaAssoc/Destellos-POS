import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  runTransaction,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { handleFirestoreError, OperationType } from '../../lib/firestoreErrors';
import {
  formatCashShiftFolio,
  formatConsecutiveFolio,
  formatCurrency,
  formatLayawayFolio,
  generateId,
  getBranchFolioPrefix,
  hashPin,
  isInternalAuthUser,
  normalizeUsername,
  toMillis,
  truncateStr,
} from '../../lib/utils';
import {
  DEFAULT_BRANCH_LIST,
  DEFAULT_BRANDING_CONFIG,
  DEFAULT_PRODUCT_CATEGORIES,
  FIELD_LIMITS,
  FULL_ADMIN_PERMISSIONS,
  USER_ROLE_LABELS,
  type AuditLog,
  type BranchesConfig,
  type BrandingConfig,
  type CashRegisterShift,
  type CategoriesConfig,
  type Customer,
  type Layaway,
  type LayawayPayment,
  type Product,
  type Sale,
  type SaleItem,
  type StockMap,
  type UserProfile,
} from '../../types/boutique';
import type {
  AuditPayload,
  BulkExcelImportResult,
  IAuthService,
  ICustomerService,
  IDataProvider,
  IInventoryService,
  ILayawayService,
  ILogService,
  ISalesService,
} from '../types';

function buildFirestoreAuditDoc(payload: AuditPayload) {
  return {
    userUid: payload.userUid,
    userName: truncateStr(payload.userName || 'Usuario', FIELD_LIMITS.DISPLAY_NAME_MAX),
    userUsuario: truncateStr(
      normalizeUsername(payload.userUsuario || 'usuario'),
      FIELD_LIMITS.USERNAME_MAX
    ),
    branchId: payload.branchId,
    branchName: truncateStr(payload.branchName || 'General', FIELD_LIMITS.BRANCH_NAME_MAX),
    actionType: payload.actionType,
    description: truncateStr(payload.description, FIELD_LIMITS.AUDIT_DESC_MAX),
    createdAt: serverTimestamp(),
  };
}

const logService: ILogService = {
  async recordAuditLog(payload) {
    const logId = generateId('log');
    const path = `audit_logs/${logId}`;
    try {
      await setDoc(doc(db, 'audit_logs', logId), buildFirestoreAuditDoc(payload));
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  },

  subscribeLogs(limitCount, onData, onError) {
    const q = query(
      collection(db, 'audit_logs'),
      orderBy('createdAt', 'desc'),
      limit(limitCount)
    );
    return onSnapshot(
      q,
      (snap) => {
        onData(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AuditLog, 'id'>) })));
      },
      (err) => {
        if (onError) {
          onError(err);
          return;
        }
        handleFirestoreError(err, OperationType.LIST, 'audit_logs');
      }
    );
  },
};

const authService: IAuthService = {
  subscribeBranding(onData, onError) {
    return onSnapshot(
      doc(db, 'settings', 'branding'),
      (snap) => {
        if (snap.exists()) {
          onData(snap.data() as BrandingConfig);
        }
      },
      (error) => {
        if (onError) {
          onError(error);
        } else {
          console.warn('Error escuchando identidad de empresa:', error.message);
        }
      }
    );
  },

  subscribeBranches(onData, onError) {
    return onSnapshot(
      doc(db, 'settings', 'branches'),
      (snap) => {
        onData(snap.exists() ? (snap.data() as BranchesConfig) : null);
      },
      (error) => {
        if (onError) {
          onError(error);
        } else {
          console.warn('Error escuchando configuración de sucursales:', error.message);
        }
      }
    );
  },

  subscribeCategories(onData, onError) {
    return onSnapshot(
      doc(db, 'settings', 'categories'),
      (snap) => {
        if (!snap.exists()) {
          onData(null);
          return;
        }
        const data = snap.data() as CategoriesConfig;
        if (Array.isArray(data.items) && data.items.length > 0) {
          onData(data.items.filter((c) => typeof c === 'string' && c.trim().length > 0));
        } else {
          onData(null);
        }
      },
      (error) => {
        if (onError) {
          onError(error);
        } else {
          console.warn('Error escuchando configuración de categorías:', error.message);
        }
      }
    );
  },

  subscribeUsers(onData, onError) {
    return onSnapshot(
      query(collection(db, 'users'), limit(500)),
      (snap) => {
        const list = snap.docs
          .map((d) => d.data())
          .filter((d): d is UserProfile => isInternalAuthUser(d))
          .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
        onData(list);
      },
      (error) => {
        if (onError) {
          onError(error);
          return;
        }
        handleFirestoreError(error, OperationType.LIST, 'users');
      }
    );
  },

  subscribeUserProfile(userId, onData, onError) {
    const userRef = doc(db, 'users', userId);
    return onSnapshot(
      userRef,
      (snap) => {
        if (!snap.exists()) {
          onData(null, 'not_found');
          return;
        }
        const raw = snap.data();
        if (!isInternalAuthUser(raw)) {
          onData(null, 'invalid');
          return;
        }
        if (!raw.activo) {
          onData(null, 'inactive');
          return;
        }
        onData(raw);
      },
      (error) => {
        if (onError) {
          onError(error);
          return;
        }
        handleFirestoreError(error, OperationType.GET, `users/${userId}`);
      }
    );
  },

  async registerInitialAdmin({ nombreCompleto, usuario, pin, defaultBranchId }) {
    const cleanName = truncateStr(nombreCompleto, FIELD_LIMITS.DISPLAY_NAME_MAX);
    const cleanUsuario = normalizeUsername(usuario);

    const existingSnap = await getDocs(query(collection(db, 'users'), limit(500)));
    const hasExistingInternal = existingSnap.docs.some((d) => isInternalAuthUser(d.data()));
    if (hasExistingInternal) {
      throw new Error(
        'Ya existe un administrador registrado. Inicia sesión con tus credenciales.'
      );
    }

    const [pinHash, branchesSnap, brandingSnap, categoriesSnap] = await Promise.all([
      hashPin(pin),
      getDoc(doc(db, 'settings', 'branches')),
      getDoc(doc(db, 'settings', 'branding')),
      getDoc(doc(db, 'settings', 'categories')),
    ]);

    const adminId = generateId('usr');
    const batch = writeBatch(db);

    for (const legacyDoc of existingSnap.docs) {
      if (!isInternalAuthUser(legacyDoc.data())) {
        batch.delete(legacyDoc.ref);
      }
    }

    const adminProfile: UserProfile = {
      id: adminId,
      nombreCompleto: cleanName,
      usuario: cleanUsuario,
      pinHash,
      rol: 'admin',
      sucursalAsignada: defaultBranchId || 'branch_1',
      permisos: FULL_ADMIN_PERMISSIONS,
      modoOscuro: false,
      activo: true,
      operatingScope: 'general',
    };

    batch.set(doc(db, 'users', adminId), {
      ...adminProfile,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastLoginAt: serverTimestamp(),
    });

    if (!branchesSnap.exists()) {
      batch.set(doc(db, 'settings', 'branches'), {
        items: DEFAULT_BRANCH_LIST,
        updatedAt: serverTimestamp(),
        updatedByUid: adminId,
      });
    }

    if (!categoriesSnap.exists()) {
      batch.set(doc(db, 'settings', 'categories'), {
        items: [...DEFAULT_PRODUCT_CATEGORIES],
        updatedAt: serverTimestamp(),
        updatedByUid: adminId,
      });
    }

    if (!brandingSnap.exists()) {
      batch.set(doc(db, 'settings', 'branding'), {
        ...DEFAULT_BRANDING_CONFIG,
        updatedAt: serverTimestamp(),
        updatedByUid: adminId,
      });
    }

    batch.set(
      doc(db, 'audit_logs', generateId('log')),
      buildFirestoreAuditDoc({
        userUid: adminId,
        userName: cleanName,
        userUsuario: cleanUsuario,
        branchId: 'all',
        branchName: 'Todas las sucursales',
        actionType: 'CREACION_USUARIO',
        description: `Registro inicial de Administrador Maestro ${cleanName} (@${cleanUsuario}).`,
      })
    );

    await batch.commit();
    return { user: adminProfile };
  },

  async loginWithCredentials({ usuario, pin, resolveBranchName }) {
    const cleanUsuario = normalizeUsername(usuario);
    const q = query(collection(db, 'users'), where('usuario', '==', cleanUsuario), limit(5));
    const snap = await getDocs(q);

    const matchedDoc = snap.docs.find((d) => isInternalAuthUser(d.data()));
    if (!matchedDoc) {
      throw new Error('Usuario o contraseña / PIN incorrectos.');
    }

    const userData = matchedDoc.data() as UserProfile;
    const enteredHash = await hashPin(pin);
    if (enteredHash !== userData.pinHash) {
      throw new Error('Usuario o contraseña / PIN incorrectos.');
    }

    if (!userData.activo) {
      throw new Error('Tu cuenta se encuentra suspendida. Contacta a un administrador.');
    }

    const batch = writeBatch(db);
    batch.update(doc(db, 'users', userData.id), {
      lastLoginAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const branchName = resolveBranchName(userData.sucursalAsignada);
    batch.set(
      doc(db, 'audit_logs', generateId('log')),
      buildFirestoreAuditDoc({
        userUid: userData.id,
        userName: userData.nombreCompleto,
        userUsuario: userData.usuario,
        branchId: userData.sucursalAsignada,
        branchName,
        actionType: 'INICIO_SESION',
        description: `Inicio de sesión interno de ${userData.nombreCompleto} (@${userData.usuario}) en ${branchName}.`,
      })
    );

    await batch.commit();
    return { user: userData };
  },

  async logout(actor, branchName) {
    await logService.recordAuditLog({
      userUid: actor.id,
      userName: actor.nombreCompleto,
      userUsuario: actor.usuario,
      branchId: actor.sucursalAsignada,
      branchName,
      actionType: 'CIERRE_SESION',
      description: `Cierre de sesión de ${actor.nombreCompleto} (@${actor.usuario}) en ${branchName}.`,
    });
  },

  async toggleTheme(userId, nextDark) {
    try {
      await updateDoc(doc(db, 'users', userId), {
        modoOscuro: nextDark,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${userId}`);
    }
  },

  async setOperatingScope(userId, scope) {
    try {
      await updateDoc(doc(db, 'users', userId), {
        operatingScope: scope,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${userId}`);
    }
  },

  async createUser(input, actor, branchName) {
    const userId = generateId('usr');
    const newProfile: UserProfile = {
      id: userId,
      nombreCompleto: input.nombreCompleto,
      usuario: input.usuario,
      pinHash: input.pinHash,
      rol: input.rol,
      sucursalAsignada: input.sucursalAsignada,
      permisos: input.permisos,
      modoOscuro: false,
      activo: input.activo,
    };

    try {
      const batch = writeBatch(db);
      batch.set(doc(db, 'users', userId), {
        ...newProfile,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        lastLoginAt: serverTimestamp(),
      });
      batch.set(
        doc(db, 'audit_logs', generateId('log')),
        buildFirestoreAuditDoc({
          userUid: actor.id,
          userName: actor.nombreCompleto,
          userUsuario: actor.usuario,
          branchId: input.sucursalAsignada,
          branchName,
          actionType: 'CREACION_USUARIO',
          description: `Alta de usuario ${input.nombreCompleto} (@${input.usuario}) como ${USER_ROLE_LABELS[input.rol]} en ${branchName}.`,
        })
      );
      await batch.commit();
      return newProfile;
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'users');
    }
  },

  async updateUser(input, actor, branchName) {
    const { targetUser } = input;
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'users', targetUser.id), {
        nombreCompleto: input.nombreCompleto,
        usuario: input.usuario,
        pinHash: input.pinHash,
        rol: input.isEditingSelf ? targetUser.rol : input.rol,
        sucursalAsignada: input.sucursalAsignada,
        activo: input.isEditingSelf ? true : input.activo,
        permisos: input.isEditingSelf ? FULL_ADMIN_PERMISSIONS : input.permisos,
        updatedAt: serverTimestamp(),
      });

      const pinWasReset = input.pinHash !== targetUser.pinHash;
      batch.set(
        doc(db, 'audit_logs', generateId('log')),
        buildFirestoreAuditDoc({
          userUid: actor.id,
          userName: actor.nombreCompleto,
          userUsuario: actor.usuario,
          branchId: input.sucursalAsignada,
          branchName,
          actionType: 'EDICION_USUARIO',
          description: `Edición de usuario ${input.nombreCompleto} (@${input.usuario}): Rol ${USER_ROLE_LABELS[input.rol]}, Sucursal ${branchName}, Estado ${input.activo ? 'Activo' : 'Suspendido'}${pinWasReset ? ' (PIN restablecido)' : ''}.`,
        })
      );
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${targetUser.id}`);
    }
  },

  async toggleUserPermission({ targetUser, nextPermissions, permLabel, enabled, branchName }, actor) {
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'users', targetUser.id), {
        permisos: nextPermissions,
        updatedAt: serverTimestamp(),
      });
      batch.set(
        doc(db, 'audit_logs', generateId('log')),
        buildFirestoreAuditDoc({
          userUid: actor.id,
          userName: actor.nombreCompleto,
          userUsuario: actor.usuario,
          branchId: targetUser.sucursalAsignada,
          branchName,
          actionType: 'CAMBIO_PERMISOS',
          description: `Permiso "${permLabel}" ${enabled ? 'activado' : 'desactivado'} para ${targetUser.nombreCompleto} (@${targetUser.usuario}).`,
        })
      );
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${targetUser.id}`);
    }
  },

  async deleteUser(userId) {
    try {
      await deleteDoc(doc(db, 'users', userId));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `users/${userId}`);
    }
  },

  async updateBranding({ companyName, companyLogoUrl }, actor) {
    try {
      const batch = writeBatch(db);
      batch.set(doc(db, 'settings', 'branding'), {
        companyName,
        companyLogoUrl,
        updatedAt: serverTimestamp(),
        updatedByUid: actor.id,
      });
      batch.set(
        doc(db, 'audit_logs', generateId('log')),
        buildFirestoreAuditDoc({
          userUid: actor.id,
          userName: actor.nombreCompleto,
          userUsuario: actor.usuario,
          branchId: 'all',
          branchName: 'Todas las sucursales',
          actionType: 'CONFIGURACION_EMPRESA',
          description: `Actualización de identidad de empresa: Nombre "${companyName}", Logotipo ${companyLogoUrl ? 'configurado' : 'sin logotipo'}.`,
        })
      );
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'settings/branding');
    }
  },
};

const inventoryService: IInventoryService = {
  subscribeProducts(onData, onError) {
    const q = query(collection(db, 'products'), orderBy('name', 'asc'), limit(5000));
    return onSnapshot(
      q,
      (snap) => {
        onData(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Product, 'id'>) })));
      },
      (err) => {
        if (onError) {
          onError(err);
          return;
        }
        handleFirestoreError(err, OperationType.LIST, 'products');
      }
    );
  },

  async findDuplicateSku(sku, excludeProductId) {
    try {
      const dupSnap = await getDocs(
        query(collection(db, 'products'), where('sku', '==', sku), limit(5))
      );
      const found = dupSnap.docs.find((d) => d.id !== excludeProductId);
      if (!found) return null;
      const dupData = found.data() as Partial<Product>;
      return { id: found.id, name: dupData.name };
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, 'products');
    }
  },

  async createProduct(input, actor, branchId, branchName) {
    const prodId = generateId('prod');
    const prodRef = doc(db, 'products', prodId);
    const newProductRecord: Product = {
      id: prodId,
      sku: input.sku,
      barcodeSKU: input.sku,
      name: input.name,
      category: input.category,
      size: input.size,
      color: input.color,
      price: input.price,
      stock: input.stock,
      createdByUid: actor.id,
    };

    try {
      const batch = writeBatch(db);
      batch.set(prodRef, {
        sku: input.sku,
        barcodeSKU: input.sku,
        name: input.name,
        category: input.category,
        size: input.size,
        color: input.color,
        price: input.price,
        stock: input.stock,
        createdByUid: actor.id,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.set(
        doc(db, 'audit_logs', generateId('log')),
        buildFirestoreAuditDoc({
          userUid: actor.id,
          userName: actor.nombreCompleto,
          userUsuario: actor.usuario,
          branchId,
          branchName,
          actionType: 'ALTA_PRODUCTO',
          description: `Alta de nuevo producto "${input.name}" (Código de barras / SKU: ${input.sku}, Categoría: ${input.category}, Talla: ${input.size}, Color: ${input.color}, Precio: ${formatCurrency(input.price)}).`,
        })
      );
      await batch.commit();
      return newProductRecord;
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `products/${prodId}`);
    }
  },

  async updateProduct(productId, input, actor, branchId, branchName) {
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'products', productId), {
        sku: input.sku,
        barcodeSKU: input.sku,
        name: input.name,
        category: input.category,
        size: input.size,
        color: input.color,
        price: input.price,
        stock: input.stock,
        updatedAt: serverTimestamp(),
      });
      batch.set(
        doc(db, 'audit_logs', generateId('log')),
        buildFirestoreAuditDoc({
          userUid: actor.id,
          userName: actor.nombreCompleto,
          userUsuario: actor.usuario,
          branchId,
          branchName,
          actionType: 'ALTA_PRODUCTO',
          description: `Actualización de producto "${input.name}" (Código de barras / SKU: ${input.sku}, Precio: ${formatCurrency(input.price)}).`,
        })
      );
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `products/${productId}`);
    }
  },

  async deleteProduct(productId) {
    try {
      await deleteDoc(doc(db, 'products', productId));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `products/${productId}`);
    }
  },

  async adjustStock(input, actor) {
    const prodRef = doc(db, 'products', input.productId);
    const logRef = doc(db, 'audit_logs', generateId('log'));
    const isDiscard = input.mode === 'discard';
    const cleanReason = (input.reason || '').trim();

    let previousStock = 0;
    let nextStock = 0;

    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(prodRef);
        if (!snap.exists()) {
          throw new Error('El producto ya no existe en el catálogo.');
        }

        const data = snap.data() as Product;
        previousStock = data.stock?.[input.branchId] ?? 0;

        if (isDiscard && input.quantity > previousStock) {
          throw new Error(
            `No puedes descartar ${input.quantity} unidades; solo hay ${previousStock} disponibles en ${input.branchName}.`
          );
        }

        nextStock = isDiscard ? previousStock - input.quantity : previousStock + input.quantity;
        const updatedStock: StockMap = {
          ...data.stock,
          [input.branchId]: nextStock,
        };

        tx.update(prodRef, {
          stock: updatedStock,
          updatedAt: serverTimestamp(),
        });

        const noteSuffix = cleanReason ? ` Motivo: ${cleanReason}.` : '';
        tx.set(
          logRef,
          buildFirestoreAuditDoc({
            userUid: actor.id,
            userName: actor.nombreCompleto,
            userUsuario: actor.usuario,
            branchId: input.branchId,
            branchName: input.branchName,
            actionType: isDiscard ? 'DESCARTE_STOCK' : 'ENTRADA_STOCK',
            description: isDiscard
              ? `Descarte de ${input.quantity} u. de "${data.name}" (SKU ${data.sku}) en ${input.branchName}. Stock: ${previousStock} -> ${nextStock}.${noteSuffix}`
              : `Entrada de ${input.quantity} u. de "${data.name}" (SKU ${data.sku}) en ${input.branchName}. Stock: ${previousStock} -> ${nextStock}.${noteSuffix}`,
          })
        );
      });

      return { previousStock, nextStock };
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('No puedes descartar') || msg.includes('ya no existe')) {
        throw err;
      }
      handleFirestoreError(err, OperationType.UPDATE, `products/${input.productId}`);
    }
  },

  async bulkImportExcel(input, actor, onProgress) {
    const BATCH_CHUNK_SIZE = 400;
    const totalItems = input.items.length;
    const totalBatches = Math.ceil(totalItems / BATCH_CHUNK_SIZE);

    try {
      const mergedCategories = [...input.existingCategories, ...input.categoriesToAdd].slice(
        0,
        50
      );
      if (input.categoriesToAdd.length > 0) {
        const catBatch = writeBatch(db);
        catBatch.set(doc(db, 'settings', 'categories'), {
          items: mergedCategories,
          updatedAt: serverTimestamp(),
          updatedByUid: actor.id,
        });
        await catBatch.commit();
      }

      let insertedCount = 0;
      const createdProducts: Product[] = [];

      for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
        const start = batchIdx * BATCH_CHUNK_SIZE;
        const chunk = input.items.slice(start, start + BATCH_CHUNK_SIZE);

        onProgress?.({
          done: insertedCount,
          total: totalItems,
          currentBatch: batchIdx + 1,
          totalBatches,
        });

        const batch = writeBatch(db);

        for (const item of chunk) {
          const prodId = generateId('prod');
          const prodRef = doc(db, 'products', prodId);

          const payload: Record<string, unknown> = {
            sku: item.barcodeSKU,
            barcodeSKU: item.barcodeSKU,
            name: item.name,
            category: item.category,
            size: item.size,
            color: item.color,
            price: item.price,
            stock: item.stock,
            createdByUid: actor.id,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };

          if (item.codigoModelo) payload.codigoModelo = item.codigoModelo;
          if (item.codigoActual) payload.codigoActual = item.codigoActual;
          if (item.marca) payload.marca = item.marca;
          if (item.especificaciones) payload.especificaciones = item.especificaciones;
          if (item.estatusOriginal) payload.estatusOriginal = item.estatusOriginal;
          if (item.costoReferencia !== undefined) {
            payload.costoReferencia = item.costoReferencia;
          }

          batch.set(prodRef, payload);
          createdProducts.push({
            id: prodId,
            sku: item.barcodeSKU,
            barcodeSKU: item.barcodeSKU,
            name: item.name,
            category: item.category,
            size: item.size,
            color: item.color,
            price: item.price,
            stock: item.stock,
            createdByUid: actor.id,
            codigoModelo: item.codigoModelo,
            codigoActual: item.codigoActual,
            marca: item.marca,
            especificaciones: item.especificaciones,
            estatusOriginal: item.estatusOriginal,
            costoReferencia: item.costoReferencia,
          });
        }

        if (batchIdx === totalBatches - 1) {
          batch.set(
            doc(db, 'audit_logs', generateId('log')),
            buildFirestoreAuditDoc({
              userUid: actor.id,
              userName: actor.nombreCompleto,
              userUsuario: actor.usuario,
              branchId: input.primaryBranchId,
              branchName: input.primaryBranchName,
              actionType: 'IMPORTACION_EXCEL',
              description: truncateStr(input.summaryText, FIELD_LIMITS.AUDIT_DESC_MAX),
            })
          );
        }

        await batch.commit();
        insertedCount += chunk.length;

        onProgress?.({
          done: insertedCount,
          total: totalItems,
          currentBatch: batchIdx + 1,
          totalBatches,
        });
      }

      const result: BulkExcelImportResult = {
        insertedCount,
        categoriesAdded: input.categoriesToAdd,
        createdProducts,
      };
      return result;
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'products');
    }
  },

  async clearAllProducts(actor, onProgress) {
    let totalDeleted = 0;
    try {
      while (true) {
        const snap = await getDocs(query(collection(db, 'products'), limit(400)));
        if (snap.empty) break;

        const batch = writeBatch(db);
        for (const d of snap.docs) {
          batch.delete(d.ref);
        }
        await batch.commit();

        totalDeleted += snap.size;
        onProgress?.(totalDeleted);
      }

      if (totalDeleted > 0) {
        await logService.recordAuditLog({
          userUid: actor.id,
          userName: actor.nombreCompleto,
          userUsuario: actor.usuario,
          branchId: 'all',
          branchName: 'Todas las sucursales',
          actionType: 'VACIADO_INVENTARIO',
          description: `Vaciado total temporal de inventario ejecutado: ${totalDeleted} producto(s) eliminado(s) de Cloud Firestore.`,
        });
      }

      return totalDeleted;
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'products');
    }
  },

  async updateCategories({ items, auditDescription, renamed, affectedProductIds }, actor) {
    try {
      const batch = writeBatch(db);
      batch.set(doc(db, 'settings', 'categories'), {
        items,
        updatedAt: serverTimestamp(),
        updatedByUid: actor.id,
      });

      if (renamed && renamed.from !== renamed.to && affectedProductIds?.length) {
        for (const pid of affectedProductIds.slice(0, 450)) {
          batch.update(doc(db, 'products', pid), {
            category: renamed.to,
            updatedAt: serverTimestamp(),
          });
        }
      }

      batch.set(
        doc(db, 'audit_logs', generateId('log')),
        buildFirestoreAuditDoc({
          userUid: actor.id,
          userName: actor.nombreCompleto,
          userUsuario: actor.usuario,
          branchId: 'all',
          branchName: 'Todas las sucursales',
          actionType: 'CONFIGURACION_CATEGORIAS',
          description: auditDescription,
        })
      );

      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'settings/categories');
    }
  },

  async updateBranches({ items, auditDescription }, actor) {
    try {
      const batch = writeBatch(db);
      batch.set(doc(db, 'settings', 'branches'), {
        items,
        updatedAt: serverTimestamp(),
        updatedByUid: actor.id,
      });

      batch.set(
        doc(db, 'audit_logs', generateId('log')),
        buildFirestoreAuditDoc({
          userUid: actor.id,
          userName: actor.nombreCompleto,
          userUsuario: actor.usuario,
          branchId: 'all',
          branchName: 'Todas las sucursales',
          actionType: 'CONFIGURACION_SUCURSALES',
          description: auditDescription,
        })
      );

      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'settings/branches');
    }
  },
};

const salesService: ISalesService = {
  subscribeSales({ branchId, customerId, limitCount = 250 }, onData, onError) {
    const q = customerId
      ? query(
          collection(db, 'sales'),
          where('customerId', '==', customerId),
          limit(limitCount)
        )
      : branchId
        ? query(
            collection(db, 'sales'),
            where('branchId', '==', branchId),
            limit(limitCount)
          )
        : query(collection(db, 'sales'), orderBy('createdAt', 'desc'), limit(limitCount));

    return onSnapshot(
      q,
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<Sale, 'id'>) }) as Sale)
          .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
        onData(list);
      },
      (error) => {
        if (onError) {
          onError(error);
          return;
        }
        handleFirestoreError(error, OperationType.LIST, 'sales');
      }
    );
  },

  async createSale(input, actor) {
    const saleId = generateId('sale');
    const saleRef = doc(db, 'sales', saleId);
    const counterRef = doc(db, 'counters', input.branchId);
    const logRef = doc(db, 'audit_logs', generateId('log'));
    let createdSaleData: (Sale & { issuedLocallyAt?: Date }) | null = null;

    try {
      await runTransaction(db, async (tx) => {
        const prodRefs = input.items.map((line) => doc(db, 'products', line.productId));
        const [counterSnap, ...prodSnaps] = await Promise.all([
          tx.get(counterRef),
          ...prodRefs.map((r) => tx.get(r)),
        ]);

        const currentSeq = counterSnap.exists()
          ? Number(counterSnap.data()?.lastSequence) || 0
          : 0;
        const nextSequence = currentSeq + 1;
        const assignedFolio = formatConsecutiveFolio(input.branchId, nextSequence);

        const validatedItems: SaleItem[] = [];
        const stockUpdates: { ref: (typeof prodRefs)[number]; stock: StockMap }[] = [];

        for (let i = 0; i < input.items.length; i++) {
          const line = input.items[i];
          const snap = prodSnaps[i];
          if (!snap.exists()) {
            throw new Error(`El producto "${line.productName}" ya no existe en el catálogo.`);
          }

          const freshData = snap.data() as Product;
          const currentQty = freshData.stock?.[input.branchId] ?? 0;

          if (currentQty < line.quantity) {
            throw new Error(
              `Stock insuficiente para "${freshData.name}" en ${input.branchName}. Disponible: ${currentQty}, solicitado: ${line.quantity}.`
            );
          }

          const nextStock: StockMap = {
            ...freshData.stock,
            [input.branchId]: currentQty - line.quantity,
          };

          stockUpdates.push({ ref: prodRefs[i], stock: nextStock });

          validatedItems.push({
            productId: line.productId,
            sku: freshData.sku,
            name: freshData.name,
            size: freshData.size,
            color: freshData.color,
            unitPrice: freshData.price,
            quantity: line.quantity,
            lineTotal: Number((freshData.price * line.quantity).toFixed(2)),
          });
        }

        if (counterSnap.exists()) {
          tx.update(counterRef, {
            branchId: input.branchId,
            lastSequence: nextSequence,
            updatedAt: serverTimestamp(),
          });
        } else {
          tx.set(counterRef, {
            branchId: input.branchId,
            lastSequence: 1,
            updatedAt: serverTimestamp(),
          });
        }

        for (const upd of stockUpdates) {
          tx.update(upd.ref, {
            stock: upd.stock,
            updatedAt: serverTimestamp(),
          });
        }

        const salePayload: Omit<Sale, 'id' | 'createdAt'> & {
          createdAt: ReturnType<typeof serverTimestamp>;
        } = {
          folio: assignedFolio,
          branchId: input.branchId,
          branchName: truncateStr(input.branchName, FIELD_LIMITS.BRANCH_NAME_MAX),
          sellerUid: actor.id,
          sellerName: truncateStr(actor.nombreCompleto, FIELD_LIMITS.DISPLAY_NAME_MAX),
          sellerUsuario: truncateStr(actor.usuario, FIELD_LIMITS.USERNAME_MAX),
          items: validatedItems,
          subtotal: input.subtotal,
          discountType: input.discountType,
          discountValue: input.discountValue,
          discountAmount: input.discountAmount,
          total: input.total,
          paymentMethod: input.paymentMethod,
          cashReceived: input.cashReceived,
          changeGiven: input.changeGiven,
          cardReference: input.cardReference,
          transferReference: input.transferReference,
          status: 'completada',
          ...(input.customer
            ? {
                customerId: input.customer.id,
                customerName: truncateStr(
                  input.customer.nombreCompleto,
                  FIELD_LIMITS.DISPLAY_NAME_MAX
                ),
              }
            : {}),
          createdAt: serverTimestamp(),
        };

        tx.set(saleRef, salePayload);

        const totalUnits = validatedItems.reduce((sum, it) => sum + it.quantity, 0);
        const refDetail = input.cardReference || input.transferReference;
        tx.set(
          logRef,
          buildFirestoreAuditDoc({
            userUid: actor.id,
            userName: actor.nombreCompleto,
            userUsuario: actor.usuario,
            branchId: input.branchId,
            branchName: input.branchName,
            actionType: 'VENTA_REALIZADA',
            description: `Ticket folio ${assignedFolio} emitido por ${formatCurrency(input.total)} (${totalUnits} u., pago: ${input.paymentMethod}${refDetail ? `, ref: ${refDetail}` : ''}${input.customer ? `, cliente: ${input.customer.nombreCompleto}` : ''}) en ${input.branchName}.`,
          })
        );

        createdSaleData = {
          id: saleId,
          ...salePayload,
          createdAt: undefined,
          issuedLocallyAt: new Date(),
        };
      });

      if (!createdSaleData) {
        throw new Error('No se pudo generar el ticket de venta.');
      }
      return createdSaleData;
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('Stock insuficiente') || msg.includes('ya no existe')) {
        throw err;
      }
      handleFirestoreError(err, OperationType.WRITE, `sales/${saleId}`);
    }
  },

  async cancelSale({ sale, reason }, actor) {
    const saleRef = doc(db, 'sales', sale.id);
    const logRef = doc(db, 'audit_logs', generateId('log'));

    const qtyByProduct = new Map<string, number>();
    for (const item of sale.items) {
      qtyByProduct.set(item.productId, (qtyByProduct.get(item.productId) ?? 0) + item.quantity);
    }
    const uniqueProductIds = Array.from(qtyByProduct.keys());

    try {
      await runTransaction(db, async (tx) => {
        const prodRefs = uniqueProductIds.map((pid) => doc(db, 'products', pid));
        const [saleSnap, ...prodSnaps] = await Promise.all([
          tx.get(saleRef),
          ...prodRefs.map((r) => tx.get(r)),
        ]);

        if (!saleSnap.exists()) {
          throw new Error('El ticket seleccionado ya no existe.');
        }
        const currentSale = saleSnap.data() as Sale;
        if (currentSale.status === 'cancelada') {
          throw new Error('Esta venta ya fue cancelada previamente.');
        }

        for (let i = 0; i < uniqueProductIds.length; i++) {
          const pSnap = prodSnaps[i];
          if (!pSnap.exists()) continue;
          const pData = pSnap.data() as Product;
          const qtyToRestore = qtyByProduct.get(uniqueProductIds[i]) ?? 0;
          if (qtyToRestore <= 0) continue;
          const currentQty = pData.stock?.[currentSale.branchId] ?? 0;
          const nextStock: StockMap = {
            ...pData.stock,
            [currentSale.branchId]: currentQty + qtyToRestore,
          };
          tx.update(prodRefs[i], {
            stock: nextStock,
            updatedAt: serverTimestamp(),
          });
        }

        tx.update(saleRef, {
          status: 'cancelada',
          cancelledAt: serverTimestamp(),
          cancelledByUid: actor.id,
          cancelledByName: truncateStr(actor.nombreCompleto, FIELD_LIMITS.DISPLAY_NAME_MAX),
          cancellationReason: reason,
          updatedAt: serverTimestamp(),
        });

        const totalUnits = sale.items.reduce((sum, it) => sum + it.quantity, 0);
        tx.set(
          logRef,
          buildFirestoreAuditDoc({
            userUid: actor.id,
            userName: actor.nombreCompleto,
            userUsuario: actor.usuario,
            branchId: currentSale.branchId,
            branchName: currentSale.branchName,
            actionType: 'VENTA_CANCELADA',
            description: `Venta folio ${currentSale.folio} cancelada (${formatCurrency(currentSale.total)}, ${totalUnits} u. devueltas a ${currentSale.branchName}). Motivo: ${reason}`,
          })
        );
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('ya fue cancelada') || msg.includes('ya no existe')) {
        throw err;
      }
      handleFirestoreError(err, OperationType.UPDATE, `sales/${sale.id}`);
    }
  },

  subscribeCashShifts(branchId, onData, onError) {
    const q = query(
      collection(db, 'cash_registers'),
      where('branchId', '==', branchId),
      limit(100)
    );

    return onSnapshot(
      q,
      (snap) => {
        const list = snap.docs
          .map((d) => ({
            id: d.id,
            ...(d.data() as Omit<CashRegisterShift, 'id'>),
          }))
          .sort((a, b) => (toMillis(b.openedAt) || Date.now()) - (toMillis(a.openedAt) || Date.now()));
        onData(list);
      },
      (err) => {
        if (onError) {
          onError(err);
          return;
        }
        handleFirestoreError(err, OperationType.LIST, 'cash_registers');
      }
    );
  },

  async openCashShift({ branchId, branchName, openingFund }, actor) {
    const shiftId = generateId('caja');
    const folio = formatCashShiftFolio(branchId);

    try {
      const batch = writeBatch(db);
      const shiftRef = doc(db, 'cash_registers', shiftId);
      const logRef = doc(db, 'audit_logs', generateId('log'));

      batch.set(shiftRef, {
        id: shiftId,
        folio,
        branchId,
        branchName: truncateStr(branchName, FIELD_LIMITS.BRANCH_NAME_MAX),
        status: 'open',
        openingFund,
        openedByUid: actor.id,
        openedByName: truncateStr(actor.nombreCompleto, FIELD_LIMITS.DISPLAY_NAME_MAX),
        openedByUsuario: truncateStr(actor.usuario, FIELD_LIMITS.USERNAME_MAX),
        openedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      batch.set(
        logRef,
        buildFirestoreAuditDoc({
          userUid: actor.id,
          userName: actor.nombreCompleto,
          userUsuario: actor.usuario,
          branchId,
          branchName,
          actionType: 'APERTURA_CAJA',
          description: `Apertura de caja folio ${folio} en ${branchName} con fondo inicial de ${formatCurrency(openingFund)}.`,
        })
      );

      await batch.commit();
      return { shiftId, folio };
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `cash_registers/${shiftId}`);
    }
  },

  async closeCashShift(input, actor) {
    const { shift, branchId, branchName, summary, countedCash, difference, observations } = input;
    const diffLabel =
      difference === 0
        ? 'Cuadre exacto ($0.00)'
        : difference > 0
          ? `Sobrante de ${formatCurrency(difference)}`
          : `Faltante de ${formatCurrency(Math.abs(difference))}`;

    try {
      const batch = writeBatch(db);
      const shiftRef = doc(db, 'cash_registers', shift.id);
      const logRef = doc(db, 'audit_logs', generateId('log'));

      const closurePayload = {
        status: 'closed' as const,
        closedByUid: actor.id,
        closedByName: truncateStr(actor.nombreCompleto, FIELD_LIMITS.DISPLAY_NAME_MAX),
        closedByUsuario: truncateStr(actor.usuario, FIELD_LIMITS.USERNAME_MAX),
        closedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        directSalesCount: summary.directSalesCount,
        directSalesCash: summary.directSalesCash,
        directSalesCard: summary.directSalesCard,
        directSalesTransfer: summary.directSalesTransfer,
        directSalesTotal: summary.directSalesTotal,
        layawayPaymentsCount: summary.layawayPaymentsCount,
        layawayCash: summary.layawayCash,
        layawayCard: summary.layawayCard,
        layawayTransfer: summary.layawayTransfer,
        layawayTotal: summary.layawayTotal,
        expectedCashTotal: summary.expectedCashTotal,
        totalCard: summary.totalCard,
        totalTransfer: summary.totalTransfer,
        grandTotalIncome: summary.grandTotalIncome,
        countedCash,
        difference,
        observations,
      };

      batch.update(shiftRef, closurePayload);

      batch.set(
        logRef,
        buildFirestoreAuditDoc({
          userUid: actor.id,
          userName: actor.nombreCompleto,
          userUsuario: actor.usuario,
          branchId,
          branchName,
          actionType: 'CIERRE_CAJA',
          description: `Cierre de caja ${shift.folio} en ${branchName}. Esperado efectivo: ${formatCurrency(summary.expectedCashTotal)}, Contado: ${formatCurrency(countedCash)}, Resultado: ${diffLabel}. Ingresos del turno: ${formatCurrency(summary.grandTotalIncome)}.`,
        })
      );

      await batch.commit();

      return {
        ...shift,
        ...closurePayload,
        closedAt: undefined,
        updatedAt: undefined,
        closedLocallyAt: new Date(),
      };
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `cash_registers/${shift.id}`);
    }
  },
};

const layawayService: ILayawayService = {
  subscribeLayaways({ branchId, customerId, limitCount = 300 }, onData, onError) {
    const q = customerId
      ? query(
          collection(db, 'layaways'),
          where('customerId', '==', customerId),
          limit(limitCount)
        )
      : branchId
        ? query(
            collection(db, 'layaways'),
            where('branchId', '==', branchId),
            limit(limitCount)
          )
        : query(collection(db, 'layaways'), orderBy('createdAt', 'desc'), limit(limitCount));

    return onSnapshot(
      q,
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<Layaway, 'id'>) }))
          .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
        onData(list);
      },
      (err) => {
        if (onError) {
          onError(err);
          return;
        }
        handleFirestoreError(err, OperationType.LIST, 'layaways');
      }
    );
  },

  subscribeLayawayPayments({ layawayId, branchId, limitCount = 100 }, onData, onError) {
    const q = layawayId
      ? query(
          collection(db, 'layaway_payments'),
          where('layawayId', '==', layawayId),
          limit(limitCount)
        )
      : branchId
        ? query(
            collection(db, 'layaway_payments'),
            where('branchId', '==', branchId),
            limit(limitCount)
          )
        : query(collection(db, 'layaway_payments'), limit(limitCount));

    return onSnapshot(
      q,
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<LayawayPayment, 'id'>) }))
          .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
        onData(list);
      },
      (err) => {
        if (onError) {
          onError(err);
          return;
        }
        handleFirestoreError(err, OperationType.LIST, 'layaway_payments');
      }
    );
  },

  async createLayaway(input, actor) {
    const layawayId = generateId('apt');
    const layawayRef = doc(db, 'layaways', layawayId);
    const counterId = `layaway_${input.branchId}`;
    const counterRef = doc(db, 'counters', counterId);
    const paymentId = generateId('abn');
    const paymentRef = doc(db, 'layaway_payments', paymentId);
    const cleanNotes = truncateStr(input.notes, FIELD_LIMITS.LAYAWAY_NOTES_MAX);
    const cleanRef = truncateStr(input.reference, FIELD_LIMITS.CARD_REF_MAX);

    let generatedFolio = '';
    let createdReceipt: (LayawayPayment & { issuedLocallyAt?: Date }) | null = null;

    try {
      await runTransaction(db, async (tx) => {
        const prodRefs = input.items.map((l) => doc(db, 'products', l.productId));
        const [counterSnap, ...prodSnaps] = await Promise.all([
          tx.get(counterRef),
          ...prodRefs.map((r) => tx.get(r)),
        ]);

        const currentSeq = counterSnap.exists()
          ? Number(counterSnap.data()?.lastSequence) || 0
          : 0;
        const nextSequence = currentSeq + 1;
        generatedFolio = formatLayawayFolio(input.branchId, nextSequence);

        const validatedItems: SaleItem[] = [];
        const stockUpdates: { ref: (typeof prodRefs)[number]; stock: StockMap }[] = [];

        for (let i = 0; i < input.items.length; i++) {
          const line = input.items[i];
          const snap = prodSnaps[i];
          if (!snap.exists()) {
            throw new Error(`El producto "${line.productName}" ya no existe en el catálogo.`);
          }
          const fresh = snap.data() as Product;
          const avail = fresh.stock?.[input.branchId] ?? 0;
          if (avail < line.quantity) {
            throw new Error(
              `Stock insuficiente para "${fresh.name}" en ${input.branchName}. Disponible: ${avail}, solicitado: ${line.quantity}.`
            );
          }

          stockUpdates.push({
            ref: prodRefs[i],
            stock: {
              ...fresh.stock,
              [input.branchId]: avail - line.quantity,
            },
          });

          validatedItems.push({
            productId: line.productId,
            sku: fresh.sku,
            name: fresh.name,
            size: fresh.size,
            color: fresh.color,
            unitPrice: fresh.price,
            quantity: line.quantity,
            lineTotal: Number((fresh.price * line.quantity).toFixed(2)),
          });
        }

        const freshTotal = Number(
          validatedItems.reduce((sum, it) => sum + it.lineTotal, 0).toFixed(2)
        );
        if (input.initialDeposit > freshTotal) {
          throw new Error('El anticipo supera el total actualizado de las prendas.');
        }

        const remainingBalance = Number(Math.max(0, freshTotal - input.initialDeposit).toFixed(2));
        const isSettled = remainingBalance <= 0.009;
        const finalRemaining = isSettled ? 0 : remainingBalance;
        const finalPaid = isSettled ? freshTotal : input.initialDeposit;

        if (counterSnap.exists()) {
          tx.update(counterRef, {
            branchId: counterId,
            lastSequence: nextSequence,
            updatedAt: serverTimestamp(),
          });
        } else {
          tx.set(counterRef, {
            branchId: counterId,
            lastSequence: 1,
            updatedAt: serverTimestamp(),
          });
        }

        for (const upd of stockUpdates) {
          tx.update(upd.ref, {
            stock: upd.stock,
            updatedAt: serverTimestamp(),
          });
        }

        const layawayPayload: Record<string, unknown> = {
          id: layawayId,
          folio: generatedFolio,
          branchId: input.branchId,
          branchName: truncateStr(input.branchName, FIELD_LIMITS.BRANCH_NAME_MAX),
          customerId: input.customer.id,
          customerName: truncateStr(input.customer.nombreCompleto, FIELD_LIMITS.DISPLAY_NAME_MAX),
          customerPhone: truncateStr(input.customer.telefono, FIELD_LIMITS.PHONE_MAX),
          sellerUid: actor.id,
          sellerName: truncateStr(actor.nombreCompleto, FIELD_LIMITS.DISPLAY_NAME_MAX),
          sellerUsuario: truncateStr(actor.usuario, FIELD_LIMITS.USERNAME_MAX),
          items: validatedItems,
          total: freshTotal,
          totalPaid: finalPaid,
          remainingBalance: finalRemaining,
          status: isSettled ? 'liquidado' : 'activo',
          notes: cleanNotes,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        if (isSettled) {
          layawayPayload.settledAt = serverTimestamp();
        }
        tx.set(layawayRef, layawayPayload);

        if (finalPaid > 0) {
          const receiptFolio = `AB-${getBranchFolioPrefix(input.branchId)}-${String(nextSequence).padStart(4, '0')}-01`;
          const finalCash =
            input.paymentMethod === 'Efectivo' ? Number(input.cashReceived.toFixed(2)) : finalPaid;
          const finalChange = input.paymentMethod === 'Efectivo' ? input.changeGiven : 0;

          const paymentData = {
            id: paymentId,
            receiptFolio,
            layawayId,
            layawayFolio: generatedFolio,
            branchId: input.branchId,
            branchName: truncateStr(input.branchName, FIELD_LIMITS.BRANCH_NAME_MAX),
            customerId: input.customer.id,
            customerName: truncateStr(input.customer.nombreCompleto, FIELD_LIMITS.DISPLAY_NAME_MAX),
            sellerUid: actor.id,
            sellerName: truncateStr(actor.nombreCompleto, FIELD_LIMITS.DISPLAY_NAME_MAX),
            sellerUsuario: truncateStr(actor.usuario, FIELD_LIMITS.USERNAME_MAX),
            amount: finalPaid,
            paymentMethod: input.paymentMethod,
            cashReceived: finalCash,
            changeGiven: finalChange,
            reference: input.paymentMethod === 'Efectivo' ? '' : cleanRef,
            balanceBefore: freshTotal,
            balanceAfter: finalRemaining,
            isInitialDeposit: true,
            createdAt: serverTimestamp(),
          };
          tx.set(paymentRef, paymentData);

          createdReceipt = {
            ...paymentData,
            createdAt: undefined,
            issuedLocallyAt: new Date(),
          };
        }

        const units = validatedItems.reduce((s, it) => s + it.quantity, 0);
        tx.set(
          doc(db, 'audit_logs', generateId('log')),
          buildFirestoreAuditDoc({
            userUid: actor.id,
            userName: actor.nombreCompleto,
            userUsuario: actor.usuario,
            branchId: input.branchId,
            branchName: input.branchName,
            actionType: 'APARTADO_CREADO',
            description: `Nuevo apartado ${generatedFolio} para ${input.customer.nombreCompleto} (${units} u., Total: ${formatCurrency(freshTotal)}, Anticipo: ${formatCurrency(finalPaid)} en ${finalPaid > 0 ? input.paymentMethod : 'Sin anticipo'}).`,
          })
        );
      });

      return { folio: generatedFolio, receipt: createdReceipt };
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (
        msg.includes('Stock insuficiente') ||
        msg.includes('ya no existe') ||
        msg.includes('supera')
      ) {
        throw err;
      }
      handleFirestoreError(err, OperationType.WRITE, `layaways/${layawayId}`);
    }
  },

  async registerPayment(input, actor) {
    const layawayRef = doc(db, 'layaways', input.layawayId);
    const paymentId = generateId('abn');
    const paymentRef = doc(db, 'layaway_payments', paymentId);
    const cleanRef = truncateStr(input.reference, FIELD_LIMITS.CARD_REF_MAX);

    let createdReceipt: (LayawayPayment & { issuedLocallyAt?: Date }) | null = null;
    let isSettled = false;

    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(layawayRef);
        if (!snap.exists()) {
          throw new Error('El apartado ya no existe.');
        }
        const fresh = snap.data() as Layaway;
        if (fresh.status !== 'activo') {
          throw new Error('Este apartado ya no admite abonos porque no está activo.');
        }
        if (input.amount > fresh.remainingBalance + 0.001) {
          throw new Error(
            `El saldo pendiente actualizado es ${formatCurrency(fresh.remainingBalance)}.`
          );
        }

        const nextRemainingRaw = Number((fresh.remainingBalance - input.amount).toFixed(2));
        isSettled = nextRemainingRaw <= 0.009;
        const nextRemaining = isSettled ? 0 : nextRemainingRaw;
        const nextTotalPaid = isSettled
          ? fresh.total
          : Number((fresh.totalPaid + input.amount).toFixed(2));

        const updatePayload: Record<string, unknown> = {
          totalPaid: nextTotalPaid,
          remainingBalance: nextRemaining,
          status: isSettled ? 'liquidado' : 'activo',
          updatedAt: serverTimestamp(),
        };
        if (isSettled) {
          updatePayload.settledAt = serverTimestamp();
        }
        tx.update(layawayRef, updatePayload);

        const suffix = String(Math.floor(Date.now() % 10000)).padStart(4, '0');
        const receiptFolio = `AB-${fresh.folio.replace(/^APT-/, '')}-${suffix}`;
        const finalCash =
          input.paymentMethod === 'Efectivo' ? Number(input.cashReceived.toFixed(2)) : input.amount;
        const finalChange = input.paymentMethod === 'Efectivo' ? input.changeGiven : 0;

        const paymentData = {
          id: paymentId,
          receiptFolio,
          layawayId: fresh.id,
          layawayFolio: fresh.folio,
          branchId: fresh.branchId,
          branchName: fresh.branchName,
          customerId: fresh.customerId,
          customerName: fresh.customerName,
          sellerUid: actor.id,
          sellerName: truncateStr(actor.nombreCompleto, FIELD_LIMITS.DISPLAY_NAME_MAX),
          sellerUsuario: truncateStr(actor.usuario, FIELD_LIMITS.USERNAME_MAX),
          amount: input.amount,
          paymentMethod: input.paymentMethod,
          cashReceived: finalCash,
          changeGiven: finalChange,
          reference: input.paymentMethod === 'Efectivo' ? '' : cleanRef,
          balanceBefore: fresh.remainingBalance,
          balanceAfter: nextRemaining,
          isInitialDeposit: false,
          createdAt: serverTimestamp(),
        };
        tx.set(paymentRef, paymentData);

        tx.set(
          doc(db, 'audit_logs', generateId('log')),
          buildFirestoreAuditDoc({
            userUid: actor.id,
            userName: actor.nombreCompleto,
            userUsuario: actor.usuario,
            branchId: fresh.branchId,
            branchName: fresh.branchName,
            actionType: isSettled ? 'APARTADO_LIQUIDADO' : 'ABONO_APARTADO',
            description: isSettled
              ? `Abono final de ${formatCurrency(input.amount)} (${input.paymentMethod}${cleanRef ? `, ref: ${cleanRef}` : ''}) en ${fresh.folio} de ${fresh.customerName}. Apartado LIQUIDADO.`
              : `Abono de ${formatCurrency(input.amount)} (${input.paymentMethod}${cleanRef ? `, ref: ${cleanRef}` : ''}) en ${fresh.folio} de ${fresh.customerName}. Saldo restante: ${formatCurrency(nextRemaining)}.`,
          })
        );

        createdReceipt = {
          ...paymentData,
          createdAt: undefined,
          issuedLocallyAt: new Date(),
        };
      });

      if (!createdReceipt) {
        throw new Error('No se pudo registrar el abono.');
      }
      return { receipt: createdReceipt, settled: isSettled };
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('ya no') || msg.includes('saldo')) {
        throw err;
      }
      handleFirestoreError(err, OperationType.UPDATE, `layaways/${input.layawayId}`);
    }
  },

  async markDelivered(layaway, actor) {
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'layaways', layaway.id), {
        status: 'entregado',
        deliveredAt: serverTimestamp(),
        deliveredByUid: actor.id,
        deliveredByName: truncateStr(actor.nombreCompleto, FIELD_LIMITS.DISPLAY_NAME_MAX),
        updatedAt: serverTimestamp(),
      });

      batch.set(
        doc(db, 'audit_logs', generateId('log')),
        buildFirestoreAuditDoc({
          userUid: actor.id,
          userName: actor.nombreCompleto,
          userUsuario: actor.usuario,
          branchId: layaway.branchId,
          branchName: layaway.branchName,
          actionType: 'APARTADO_ENTREGADO',
          description: `Entrega física completada del apartado ${layaway.folio} para ${layaway.customerName}.`,
        })
      );

      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `layaways/${layaway.id}`);
    }
  },

  async cancelLayaway({ layaway, reason }, actor) {
    const layawayRef = doc(db, 'layaways', layaway.id);
    try {
      await runTransaction(db, async (tx) => {
        const layawaySnap = await tx.get(layawayRef);
        if (!layawaySnap.exists()) {
          throw new Error('El apartado ya no existe.');
        }
        const fresh = layawaySnap.data() as Layaway;
        if (fresh.status === 'entregado' || fresh.status === 'cancelado') {
          throw new Error('Este apartado ya fue entregado o cancelado.');
        }

        const prodRefs = fresh.items.map((it) => doc(db, 'products', it.productId));
        const prodSnaps = await Promise.all(prodRefs.map((r) => tx.get(r)));

        for (let i = 0; i < fresh.items.length; i++) {
          const item = fresh.items[i];
          const pSnap = prodSnaps[i];
          if (pSnap.exists()) {
            const pData = pSnap.data() as Product;
            const currentBranchStock = pData.stock?.[fresh.branchId] ?? 0;
            tx.update(prodRefs[i], {
              stock: {
                ...pData.stock,
                [fresh.branchId]: currentBranchStock + item.quantity,
              },
              updatedAt: serverTimestamp(),
            });
          }
        }

        tx.update(layawayRef, {
          status: 'cancelado',
          cancelledAt: serverTimestamp(),
          cancelledByUid: actor.id,
          cancelledByName: truncateStr(actor.nombreCompleto, FIELD_LIMITS.DISPLAY_NAME_MAX),
          cancellationReason: reason,
          updatedAt: serverTimestamp(),
        });

        tx.set(
          doc(db, 'audit_logs', generateId('log')),
          buildFirestoreAuditDoc({
            userUid: actor.id,
            userName: actor.nombreCompleto,
            userUsuario: actor.usuario,
            branchId: fresh.branchId,
            branchName: fresh.branchName,
            actionType: 'APARTADO_CANCELADO',
            description: `Cancelación de apartado ${fresh.folio} (${fresh.customerName}). Stock devuelto a ${fresh.branchName}. Motivo: ${reason}.`,
          })
        );
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('ya fue') || msg.includes('ya no')) {
        throw err;
      }
      handleFirestoreError(err, OperationType.UPDATE, `layaways/${layaway.id}`);
    }
  },
};

const customerService: ICustomerService = {
  subscribeCustomers(onData, onError) {
    const q = query(
      collection(db, 'customers'),
      orderBy('nombreCompleto', 'asc'),
      limit(500)
    );
    return onSnapshot(
      q,
      (snap) => {
        onData(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Customer, 'id'>) })));
      },
      (err) => {
        if (onError) {
          onError(err);
          return;
        }
        handleFirestoreError(err, OperationType.LIST, 'customers');
      }
    );
  },

  async createCustomer(input, branchId, branchName, actor) {
    const customerId = generateId('cli');
    const newCustomer: Customer = {
      id: customerId,
      nombreCompleto: input.nombreCompleto,
      telefono: input.telefono,
      email: input.email,
      fechaEvento: input.fechaEvento,
      notas: input.notas,
      datosFiscales: input.datosFiscales,
      createdByUid: actor.id,
      createdByName: truncateStr(actor.nombreCompleto, FIELD_LIMITS.DISPLAY_NAME_MAX),
    };

    try {
      const batch = writeBatch(db);
      batch.set(doc(db, 'customers', customerId), {
        ...newCustomer,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.set(
        doc(db, 'audit_logs', generateId('log')),
        buildFirestoreAuditDoc({
          userUid: actor.id,
          userName: actor.nombreCompleto,
          userUsuario: actor.usuario,
          branchId,
          branchName,
          actionType: 'CREACION_CLIENTE',
          description: `Alta de cliente "${input.nombreCompleto}" (WhatsApp/Tel: ${input.telefono}${input.fechaEvento ? `, Evento: ${input.fechaEvento}` : ''}${input.datosFiscales.rfc ? `, RFC: ${input.datosFiscales.rfc}` : ''}).`,
        })
      );
      await batch.commit();
      return newCustomer;
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'customers');
    }
  },

  async updateCustomer(existingCustomer, input, branchId, branchName, actor) {
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'customers', existingCustomer.id), {
        nombreCompleto: input.nombreCompleto,
        telefono: input.telefono,
        email: input.email,
        fechaEvento: input.fechaEvento,
        notas: input.notas,
        datosFiscales: input.datosFiscales,
        updatedAt: serverTimestamp(),
      });

      batch.set(
        doc(db, 'audit_logs', generateId('log')),
        buildFirestoreAuditDoc({
          userUid: actor.id,
          userName: actor.nombreCompleto,
          userUsuario: actor.usuario,
          branchId,
          branchName,
          actionType: 'EDICION_CLIENTE',
          description: `Actualización de expediente de cliente "${input.nombreCompleto}" (Tel: ${input.telefono}${input.datosFiscales.rfc ? `, RFC: ${input.datosFiscales.rfc}` : ''}).`,
        })
      );

      await batch.commit();
      return {
        ...existingCustomer,
        nombreCompleto: input.nombreCompleto,
        telefono: input.telefono,
        email: input.email,
        fechaEvento: input.fechaEvento,
        notas: input.notas,
        datosFiscales: input.datosFiscales,
      };
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `customers/${existingCustomer.id}`);
    }
  },
};

export const firestoreDataProvider: IDataProvider = {
  mode: 'firestore',
  authService,
  inventoryService,
  salesService,
  layawayService,
  customerService,
  logService,
};
