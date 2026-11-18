# Especificación de Seguridad — Atelier Aurelia

## 1. Invariantes de Datos (Data Invariants)
1. **Unicidad de Bootstrap**: El documento `/system/bootstrap` solo puede crearse una única vez cuando aún no existe, y debe estar vinculado atómicamente (`existsAfter`) a la creación del primer perfil `/users/{uid}` con `role == 'Administrador'` y a la creación inicial de `/settings/branches`.
2. **Integridad de Identidad y RBAC**: Ningún usuario no administrador puede asignarse o modificar su propio `role`, `branchId`, `permissions` o `active`. Los vendedores solo pueden actualizar sus preferencias de perfil (`theme`, `displayName`, `photoURL`, `lastLoginAt`, `updatedAt`).
3. **Aislamiento de PII**: Los correos electrónicos en `/users/{uid}` y `/user_invites/{inviteId}` solo son legibles por el propio titular o por un `Administrador` activo.
4. **Integridad de Inventario**: El stock de cada sucursal (`branch_1`, `branch_2`, `branch_3`) debe ser siempre un número entero `>= 0`. Una venta o descarte nunca puede dejar el stock en negativo.
5. **Inmutabilidad de Ventas y Auditoría**: Los documentos de `/sales/{saleId}` y `/audit_logs/{logId}` son inmutables tras su creación (sin `update` ni `delete`).
6. **Integridad Temporal**: Todo campo `createdAt` y `updatedAt` debe coincidir exactamente con `request.time`.

## 2. "Dirty Dozen" Payloads (Pruebas Adversarias)
1. **Privilege Escalation on Create**: Un usuario nuevo sin invitación intenta crear `/users/{uid}` con `role: "Administrador"` después de que `/system/bootstrap` ya existe -> **PERMISSION_DENIED**.
2. **Privilege Escalation on Self-Update**: Un `Vendedor` intenta actualizar `/users/{uid}` cambiando `role: "Administrador"` o `permissions.performSales: true` -> **PERMISSION_DENIED**.
3. **Shadow Field Injection**: Envío de un campo fantasma `isSuperAdmin: true` al crear o actualizar `/products/{productId}` -> **PERMISSION_DENIED** (`hasOnly` bloquea campos extra).
4. **Negative Stock Manipulation**: Un usuario intenta actualizar `/products/{productId}` dejando `stock.branch_1: -5` -> **PERMISSION_DENIED**.
5. **ID Poisoning Attack**: Intento de crear un documento con ID de 1500 caracteres o caracteres inválidos (`../../admin`) -> **PERMISSION_DENIED** (`isValidId` exige `^[a-zA-Z0-9_\-]+$` y `<= 128`).
6. **Unverified Email Spoofing**: Token con `email_verified == false` intentando reclamar una invitación o escribir en cualquier colección -> **PERMISSION_DENIED**.
7. **PII Blanket List Scraping**: Un `Vendedor` autenticado ejecuta `list` sobre `/users` o `/user_invites` -> **PERMISSION_DENIED**.
8. **Cross-User Sale Spoofing**: Un `Vendedor` intenta registrar una venta en `/sales/{saleId}` con `sellerUid` de otro usuario -> **PERMISSION_DENIED**.
9. **Audit Log Tampering**: Un usuario (incluso Administrador) intenta editar o eliminar un registro en `/audit_logs/{logId}` -> **PERMISSION_DENIED**.
10. **Client Timestamp Forgery**: Intento de crear un producto o venta con `createdAt` distinto a `request.time` -> **PERMISSION_DENIED**.
11. **Unauthorized Branch Sale**: Un `Vendedor` asignado a `branch_1` intenta registrar una venta en `/sales/{saleId}` con `branchId: "branch_2"` -> **PERMISSION_DENIED**.
12. **Suspended User Access**: Un usuario con `active: false` en `/users/{uid}` intenta leer `/products` o crear una venta -> **PERMISSION_DENIED**.

## 3. Verificación Automatizada de Reglas (Referencia de Test)
Las reglas se validan estáticamente con `@firebase/eslint-plugin-security-rules` y se verifican contra los 12 payloads anteriores antes de desplegar con `DeployRules`.
