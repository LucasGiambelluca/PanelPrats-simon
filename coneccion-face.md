Aquí tienes el resumen completo del video y el desglose técnico de cómo interactúa con la API de Meta.

El video demuestra cómo construir desde cero un Agente de Inteligencia Artificial automatizado para Facebook Messenger en 15 minutos, utilizando la plataforma n8n (como orquestador) y el modelo GPT-4o-mini de OpenAI [00:00:00].

Resumen del flujo paso a paso en n8n
El proyecto se divide en dos grandes fases: el "apretón de manos" (validar ante Meta que tu servidor es seguro) y el ciclo de mensajería (escuchar, pensar y responder).

El disparador (Webhook) [00:00:22]

Se crea un nodo Webhook en n8n. Este genera una URL pública que servirá como la "oreja" de tu bot para escuchar a Meta.

Creación de la App en Meta [00:00:41]

Entra a developers.facebook.com, crea una aplicación de tipo Business Portfolio y conéctala a tu portafolio comercial.

En el selector de productos de Meta, añade Facebook Messenger [00:01:26].

Superar el "Hub Challenge" (Verificación obligatoria) [00:01:34]

Para que Meta le envíe mensajes a tu URL, primero hace una petición GET de prueba enviando un código llamado hub.challenge y un Verify Token (una contraseña inventada por ti, por ejemplo: mi_bot_secreto_123).

En n8n, colocas un nodo IF [00:02:21] con dos reglas estrictas de seguridad:

Que el parámetro hub.mode sea igual a subscribe.

Que el hub.verify_token sea idéntico a tu contraseña inventada.

Si la condición se cumple, el nodo Webhook debe responder devolviendo en texto plano únicamente el valor de hub.challenge [00:03:26]. (Meta valida esto y da el OK).

Permisos y Tokens de acceso [00:04:05]

En el panel de Meta, seleccionas tu página de Facebook y te suscribes a dos eventos: messages (para leer lo que escriben) y message_reads.

Presionas Generate Token. Cópialo y guárdalo, porque Meta no te lo volverá a mostrar [00:04:44].

Capturar los mensajes de los usuarios [00:05:16]

Las verificaciones de Meta entran por el método GET, pero los mensajes reales de los usuarios entran por POST.

Activas en el Webhook de n8n la opción "Allow multiple HTTP methods". Esto creará una segunda rama de salida en el nodo dedicada exclusivamente a procesar textos recibidos.

Conectar la Inteligencia Artificial [00:05:48]

En la rama POST, agregas el nodo Advanced AI Agent conectado al modelo de OpenAI.

Configuras el parámetro de entrada buscando en el JSON que mandó Meta: entry[0].messaging[0].message.text [00:06:51].

Le redactas un System Prompt indicándole su personalidad (ej. "Eres un asistente de ventas para la empresa X...").

Despachar la respuesta hacia Meta [00:08:03]

Creas un nodo HTTP Request. Usando el botón Import de n8n, pegas el código de ejemplo de la documentación oficial de Meta para enviar un mensaje básico [00:08:42].

El autor nos recuerda que en un entorno profesional nunca dejes el Token pegado en el código; úsalo siempre como una variable de entorno [00:09:30].

Añadir memoria individual por cliente [00:11:29]

Para que el bot recuerde lo que habló con cada persona, le conectas un nodo de Memoria al Agente IA, pero cambias la clave de sesión (Session ID) poniéndole el sender_id que viene en el mensaje de Meta [00:11:58]. Así, si Juan y María hablan a la vez, la IA no mezcla sus conversaciones.

Análisis: ¿Cómo consume exactamente la API de Meta?
Técnicamente, el consumo de la API se resume en este juego de intercambio de roles:

La inversión lógica del JSON [00:09:05]: Cuando un cliente te escribe, el JSON de Meta entra diciendo:

sender.id = 111222 (El cliente)

recipient.id = 999888 (Tu página de Facebook)

Para que n8n responda, el nodo HTTP Request hace una petición POST a la Graph API de Meta invirtiendo los valores: pones como destinatario (recipient.id) el ID del cliente, y en el cuerpo del mensaje metes el texto que escupió la IA [00:10:13]:

JSON
{
  "recipient": {
    "id": "{{ ID_DEL_CLIENTE_QUE_ESCRIBIO }}"
  },
  "message": {
    "text": "{{ RESPUESTA_DE_LA_IA }}"
  }
}
Limpieza de caracteres [00:10:44]: El autor advierte un detalle crucial de la API: si la IA responde usando saltos de línea extraños, comillas dobles sin escapar o barras invertidas (\), la API de Meta rechazará el envío con un Error 400. En producción, siempre hay que poner un pequeño nodo de código intermedio que "limpie" el string de la IA antes de mandárselo a Facebook.

¿Cómo escalar esto a Instagram Direct?
En el video el autor aclara que está configurando únicamente Facebook [00:01:26]. Sin embargo, para cumplir tu objetivo de conectar Instagram, la buena noticia es que Meta unificó ambas arquitecturas.

Para replicar este mismo video en Instagram, la lógica de n8n queda intacta; los únicos tres cambios que debes hacer ocurren en el Paso 2 (dentro de Meta for Developers):

En tu panel de la aplicación, en lugar de añadir solo la tarjeta de Messenger, añade también el producto Instagram Direct.

Tu cuenta de Instagram debe ser obligatoriamente una cuenta "Profesional" o de "Empresa", y tiene que estar enlazada a la página de Facebook que usaste en el Paso 4.

En la configuración del Webhook dentro de Meta, ve a la pestaña de Instagram y suscribe ese mismo Webhook al evento messages de Instagram.

A partir de ese momento, cuando alguien te escriba en Instagram, Meta disparará exactamente el mismo JSON hacia tu Webhook de n8n, y tu bot le responderá por el chat de Instagram usando la misma lógica de sender_id.