-- Índices de la BÚSQUEDA de la lista de pedidos (routes/orders.ts, «Búsqueda general TILDE-insensible»).
--
-- La búsqueda hace siete consultas, una por columna, y cada una necesita su índice trigram con la
-- MISMA expresión que escribe el código (translate + upper + coalesce, con esas dos tablas de acentos):
-- si no coincide carácter por carácter, Postgres lo ignora y lee la tabla entera.
--
-- Los cinco primeros se crearon a mano en producción y no estaban en el repositorio. Los dos de
-- OrderItem faltaban: el 14/10/2026 cada búsqueda leía las 120.547 líneas dos veces (614 ms + 254 ms)
-- y esa sola consulta era el 80 % del tiempo de CPU de la base (210.383 llamadas, 690 ms de media) y
-- dejaba el Postgres al 99 %. Con ellos la búsqueda entera baja de ~870 ms a ~17 ms.
--
-- Requiere la extensión pg_trgm. En producción se crearon con CREATE INDEX CONCURRENTLY (sin bloquear);
-- aquí van sin CONCURRENTLY porque una migración corre dentro de una transacción.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "Order_busq_folio_trgm" ON public."Order" USING gin (translate(upper(COALESCE(folio, ''::text)), 'ÁÉÍÓÚÜÑÀÈÌÒÙÄËÏÖáéíóúüñàèìòùäëïö'::text, 'AEIOUUNAEIOUAEIOAEIOUUNAEIOUAEIO'::text) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Order_busq_encargado_trgm" ON public."Order" USING gin (translate(upper(COALESCE(encargado, ''::text)), 'ÁÉÍÓÚÜÑÀÈÌÒÙÄËÏÖáéíóúüñàèìòùäëïö'::text, 'AEIOUUNAEIOUAEIOAEIOUUNAEIOUAEIO'::text) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Client_busq_nombre_trgm" ON public."Client" USING gin (translate(upper(COALESCE(nombre, ''::text)), 'ÁÉÍÓÚÜÑÀÈÌÒÙÄËÏÖáéíóúüñàèìòùäëïö'::text, 'AEIOUUNAEIOUAEIOAEIOUUNAEIOUAEIO'::text) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Client_busq_parranda_trgm" ON public."Client" USING gin (translate(upper(COALESCE("parrandaId", ''::text)), 'ÁÉÍÓÚÜÑÀÈÌÒÙÄËÏÖáéíóúüñàèìòùäëïö'::text, 'AEIOUUNAEIOUAEIOAEIOUUNAEIOUAEIO'::text) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Seller_busq_name_trgm" ON public."Seller" USING gin (translate(upper(COALESCE(name, ''::text)), 'ÁÉÍÓÚÜÑÀÈÌÒÙÄËÏÖáéíóúüñàèìòùäëïö'::text, 'AEIOUUNAEIOUAEIOAEIOUUNAEIOUAEIO'::text) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "OrderItem_busq_producto_trgm" ON public."OrderItem" USING gin (translate(upper(COALESCE(producto, ''::text)), 'ÁÉÍÓÚÜÑÀÈÌÒÙÄËÏÖáéíóúüñàèìòùäëïö'::text, 'AEIOUUNAEIOUAEIOAEIOUUNAEIOUAEIO'::text) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "OrderItem_busq_code_trgm" ON public."OrderItem" USING gin (translate(upper(COALESCE(code, ''::text)), 'ÁÉÍÓÚÜÑÀÈÌÒÙÄËÏÖáéíóúüñàèìòùäëïö'::text, 'AEIOUUNAEIOUAEIOAEIOUUNAEIOUAEIO'::text) gin_trgm_ops);
