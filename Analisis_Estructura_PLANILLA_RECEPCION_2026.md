# Análisis de Estructura de Datos – PLANILLA RECEPCIÓN 2026

## Resumen General

El PDF **“PLANILLA RECEPCIÓN 2026”** corresponde a una planilla de seguimiento comercial y operativo de un estudio previsional. Está organizada cronológicamente por meses y registra consultas de potenciales clientes para distintos trámites previsionales.

---

## Estructura de datos principal

Cada fila representa un caso o contacto y contiene, en términos generales, los siguientes campos:

| Campo | Descripción |
|---------|-------------|
| FECHA | Fecha de ingreso o contacto |
| NOMB Y APELL | Nombre y apellido del consultante |
| MOTIVO | Tipo de trámite (Jubilación, PUAM, Pensión por Viudez, Reajuste, etc.) |
| DNI | Identificador personal |
| CONTACTO | Teléfono(s) |
| FALTANTE | Documentación o información pendiente |
| DESCRIPCIÓN | Información previsional detallada del caso |
| COMO NOS CONOCIÓ | Canal de adquisición del lead |
| ABOGADA A CARGO | Responsable asignada |
| CARPETA / SEGUIMIENTO | Estado comercial y observaciones posteriores |

---

## Contenido de la columna “Descripción”

Es el campo más rico y menos estructurado. Allí aparecen datos como:

- Fecha de nacimiento.
- Edad.
- Nacionalidad.
- Fecha de ingreso al país.
- Situación laboral.
- Cantidad estimada de años aportados.
- Beneficios previsionales vigentes.
- Hijos computables.
- Información sobre moratorias.
- Casos especiales:
  - Taxi.
  - Construcción (IERIC).
  - Transporte.
  - IPS.
  - Monotributo.
  - Pensiones.
  - Reconocimiento de servicios.

Este campo está almacenado como texto libre y no como columnas separadas.

---

## Posibles valores del campo “Motivo”

Se identifican principalmente:

- JUBILACION
- PUAM
- PENSION V
- REAJUSTE
- RTI
- OTRO
- ASESORAMIENTO

---

## Canales de captación

La columna “Cómo nos conoció” contiene principalmente:

- Facebook
- Instagram
- TikTok
- Página Web
- Recomendada/o

Estos valores son candidatos a normalización.

---

## Estados de seguimiento detectados

Se observan estados operativos como:

- SI
- NO
- PENSAR
- TRAER DOCUMENTACION
- PRESENCIAL
- HABLAR +1 año
- NO VA INICIAR
- YA LO INICIÓ
- LLAMAR MÁS ADELANTE

Actualmente estos estados aparecen mezclados con observaciones y convendría separarlos.

---

## Problemas de calidad de datos observados

### 1. Datos semiestructurados

Gran parte de la información relevante se encuentra dentro de textos largos.

Ejemplo:

> FN: 12/02/1965, 61 años, Argentino, Trabaja registrado, Aportes: 20 años...

Podría dividirse en:

- FechaNacimiento
- Edad
- Nacionalidad
- SituacionLaboral
- AñosAportes

### 2. Inconsistencia de fechas

Se observan formatos diferentes:

- 02/01/2026
- 08-01-2026
- 22-01.2026

### 3. Inconsistencia en teléfonos

Ejemplos:

- 1141837686
- 11 3072 8421
- 5491169291454
- múltiples teléfonos en una misma celda

### 4. Repetición de etiquetas

Se repiten patrones como:

- FN:
- FI:
- Aportes:
- Hijos:
- Clave de anses:

Esto facilita una futura extracción automática mediante reglas o expresiones regulares.

---

## Modelo de base de datos recomendado

### Tabla Clientes

- id_cliente
- nombre
- apellido
- dni
- fecha_nacimiento
- nacionalidad
- fecha_ingreso_pais
- telefono

### Tabla Consultas

- id_consulta
- fecha_consulta
- id_cliente
- motivo
- canal_origen
- abogada
- estado

### Tabla EvaluacionPrevisional

- id_consulta
- años_aportes
- hijos_computables
- situacion_laboral
- beneficio_actual
- observaciones_tecnicas

### Tabla Seguimiento

- id_seguimiento
- id_consulta
- fecha
- comentario
- proxima_accion

---

## Conclusión

El documento contiene una base de leads previsionales con una estructura relativamente consistente, formada por aproximadamente 10–11 columnas principales y una gran cantidad de información semiestructurada dentro del campo “Descripción”.

Las oportunidades de mejora incluyen:

1. Extraer los datos a Excel estructurado.
2. Convertir la información en una base de datos relacional.
3. Construir dashboards de conversión, origen de leads y estado de seguimiento.
4. Automatizar búsquedas, filtros y segmentación de clientes.

Además, contiene información personal sensible (DNI, teléfonos y otros identificadores), por lo que cualquier procesamiento posterior debería contemplar medidas adecuadas de protección y control de acceso.
