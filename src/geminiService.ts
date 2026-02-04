// src/geminiService.ts
// Gemini AI Service - Servicio optimizado para generación de contenido SEO

import { GoogleGenAI } from "@google/genai";
import type { Article, Section, ContentType } from "./types";

/* ======================================================
   TIPOS Y CONSTANTES
====================================================== */

interface GenerateTextParams {
  model: string;
  prompt: string;
  temperature?: number;
  maxRetries?: number;
}

interface SEOAnalysis {
  score: number;
  suggestions: string[];
}

interface KeywordsResponse {
  keywords: string[];
}

// Modelos disponibles (Flash es el más estable)
const MODELS = {
  PRO: "gemini-2.5-flash",
  FLASH: "gemini-2.5-flash",
  IMAGE: "gemini-3-pro-image-preview",
} as const;

// Configuración de reintentos
const RETRY_CONFIG = {
  MAX_ATTEMPTS: 3,
  BASE_DELAY: 1000,
  BACKOFF_MULTIPLIER: 2,
} as const;

/* ======================================================
   ARTICLE MASTER PROMPT (SEO + AEO + GEO)
====================================================== */

const ARTICLE_MASTER_PROMPT = `
PRODUCCIÓN MASIVA SEO + AEO + GEO

ROLE
You are a Senior SEO, AEO and Generative Content Strategist specialized in large-scale automated article production for WordPress and headless CMS environments.

You design content that answers real user questions, ranks in search engines, can be extracted by answer engines, and reused by generative AI systems.

OBJECTIVE
Generate ONE blog article from a business brief that answers ONE single, real, frequent and specific user question related to the product or service defined in the brief.

The article must:
- Fully answer the main doubt
- Be informative, decision-oriented and useful
- Avoid empty or generic marketing language
- Be ready for direct publication without manual editing

LANGUAGE AND LOCALIZATION RULES (MANDATORY)
- Use ONLY the language explicitly defined in the brief
- Adapt vocabulary, tone and level of formality to the country and city provided
- If the language is Spanish:
  - Use correct RAE grammar and punctuation
  - Use opening ¿ and ¡ correctly
- Never assume Spanish from Spain unless explicitly stated

GRAMMATICAL SUBJECT RULES (UNBREAKABLE)
The grammatical subject defined in the brief must be respected at all times.
If tone and subject conflict, tone adapts — the subject NEVER changes.

GENDER RULES
- If the audience is specified as female, use feminine forms
- If not specified, use masculine plural as neutral

TITLES AND BUTTONS
- Titles must never end with a period
- Buttons must never include punctuation marks
- Titles and CTAs must follow the defined tone and subject

PROCESSING LOGIC (MANDATORY SEQUENCE)

STEP 1: BUSINESS AND USER DOUBT IDENTIFICATION
- Read the business context from the brief
- Identify the main product or service
- Detect real and frequent user doubts, fears or objections
- Select ONE single, clear and specific main question
- This question defines the entire article
- The article must answer ONLY this question

STEP 2: STRUCTURE DEFINITION (CRITICAL)

The article MUST contain:

- 1 Metatitle
- 1 Metadescription
- 1 H1
- 1 Introduction
- EXACTLY 4 H2 sections
- H3 sections ONLY when products, rankings or models are presented

MANDATORY STRUCTURE RULES

H1
- MUST be a hook
- MUST be a question or an exclamation
- Sentence case
- 45–65 characters
- Never ends with a period

Introduction
- 2–3 lines
- Reframes the main doubt
- Sets expectations clearly

H2 SECTIONS (EXACTLY 4)

Each H2 MUST:
- Be a question or a strong statement
- Expand the H1 from a unique and non-overlapping angle
- Never be generic

Each H2 MUST follow this EXACT internal structure:

1. First paragraph:
   - Maximum 3 lines
   - Direct and clear answer to the H2
   - AEO-ready (extractable as a direct answer)

2. Bullet list (MANDATORY):
   - Used to clarify or structure the information
   - EACH bullet MUST follow this format:

     - **Concept before colon:** explanation after colon.

   - EVERYTHING before the colon MUST be in bold
   - No exceptions allowed

H3 SECTIONS (WHEN APPLICABLE)
- Used for product models, rankings or specific items
- Each H3 includes:
  - Short descriptive paragraph
  - Bullet list with technical or decision-oriented attributes
  - Same bold-before-colon rule applies

STEP 3: DIRECTED CONTENT GENERATION

METATITLE
- Includes the main keyword derived from the question
- Optimized for CTR
- Appropriate length for search results

METADESCRIPTION
- Clearly explains the problem
- Promises a concrete and useful answer
- No generic claims

INTERNAL LINKS (CRITICAL – UNBREAKABLE)

- EXACTLY 3 internal links per article
- Links MUST be embedded naturally within a sentence
- Links MUST be integrated as part of the narrative flow
- Links MUST use descriptive, semantic and value-driven anchor text
- URLs must belong to the WordPress domain provided in the brief

STRICTLY FORBIDDEN:
- Displaying the raw URL (example: dominio.com/contacto)
- Mentioning links as “a través de”, “en”, “desde” followed by a URL
- Using the domain name as anchor text
- Using generic anchors such as:
  - “haz clic aquí”
  - “más información”
  - “nuestros servicios”
- Placing links as standalone sentences
- Appending links at the end of a paragraph

ANCHOR TEXT QUALITY RULE
- The anchor text MUST be a phrase that makes sense even without the link
- The sentence MUST read naturally if the link is removed

Correct example:
“…puedes acceder a **[tratamientos alineados con tu bienestar diario desde mi consulta en Barcelona](URL)**.”

Incorrect examples:
“…a través de dominio.com/contacto”
“…en este enlace”
“…haz clic aquí”

INTERNAL LINK PLACEMENT RULE
- Each link must appear inside a sentence that provides value on its own
- The link must never feel technical, appended or promotional

IMAGE RECOMMENDATION
- Recommend 1 image
- Size: 1536 × 864
- Alt text must naturally include the main keyword

STEP 4: SEO, AEO AND GEO VALIDATION
Before finalizing, verify that:
- The article answers a real and frequent user doubt
- Information progresses logically without repetition
- Each H2 adds new and necessary information
- The content can be:
  - Indexed by search engines (SEO)
  - Extracted as a direct answer (AEO)
  - Reused by generative AI systems (GEO)
- Language, tone and localization match the brief
- The structure is stable and scalable for batch production

FINAL OUTPUT FORMAT (MANDATORY)

The response MUST include TWO clearly separated blocks and NOTHING else.

----------------------------------
BLOCK 1: STRUCTURAL OUTPUT (JSON)
----------------------------------

- Used for validation, automation and CMS integration
- Must reflect the REAL structure of the generated article
- No comments or explanations

Required fields:
- metatitle
- metadescription
- h1
- internal_links_count
- sections (array of the 4 H2 titles, with flags indicating bullets and H3 usage)
- image (size and alt text)

----------------------------------
BLOCK 2: EDITORIAL OUTPUT (MARKDOWN)
----------------------------------

- Publish-ready content
- Clean Markdown
- No explanations
- No comments
- No deviations from the defined structure

UNBREAKABLE RULES
- Use only the language defined in the brief
- No invented or unverifiable data
- No generic marketing language
- No overlapping ideas between sections
- Titles never end with periods
- Bullet formatting rule is mandatory
- Internal links must NEVER expose raw URLs
- The article must be usable without manual editing

`;

/* ======================================================
   INICIALIZACIÓN
====================================================== */

class GeminiService {
  private ai: GoogleGenAI;
  private readonly masterPrompt: string;

  constructor(apiKey: string) {
    if (!apiKey?.trim()) {
      throw new Error(
        "Gemini API key is required. Set VITE_GEMINI_API_KEY in your .env file."
      );
    }

    this.ai = new GoogleGenAI({ apiKey });

    this.masterPrompt = `Eres un Ingeniero SEO Senior especializado en contenido web.
Idioma: Español de España (formal y profesional).
Formato: Texto limpio sin markdown, excepto <strong> para énfasis.
Tono: Profesional, directo y orientado a resultados.
Objetivo: Crear contenido optimizado para SEO que sea valioso para usuarios y motores de búsqueda.`;

    console.log("[GeminiService] ✓ Servicio inicializado correctamente");
  }

  /* ======================================================
     UTILIDADES PRIVADAS
  ====================================================== */

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private isRetryableError(error: unknown): boolean {
    const msg = String(error).toLowerCase();
    return ["429", "quota", "timeout", "503", "unavailable"].some((k) =>
      msg.includes(k)
    );
  }

  private calculateDelay(attempt: number): number {
    return (
      RETRY_CONFIG.BASE_DELAY *
      Math.pow(RETRY_CONFIG.BACKOFF_MULTIPLIER, attempt - 1)
    );
  }

  private async executeWithRetry<T>(
    fn: () => Promise<T>,
    maxRetries: number = RETRY_CONFIG.MAX_ATTEMPTS
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        if (attempt < maxRetries && this.isRetryableError(err)) {
          await this.sleep(this.calculateDelay(attempt));
          continue;
        }
        break;
      }
    }
    throw lastError;
  }

  private extractJSON<T = any>(text: string): T | null {
    try {
      return JSON.parse(text);
    } catch {}

    const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {}
    }
    return null;
  }

  private async generateText(params: GenerateTextParams): Promise<string> {
    const { model, prompt, temperature = 0.7, maxRetries } = params;

    return this.executeWithRetry(async () => {
      const result = await this.ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          temperature,
          maxOutputTokens: 8192,
        },
      });

      if (!result.text) {
        throw new Error("Respuesta vacía del modelo");
      }

      return result.text;
    }, maxRetries);
  }

  /* ======================================================
     MÉTODOS PÚBLICOS
  ====================================================== */

  async generateKeywords(context: string): Promise<string[]> {
    const prompt = `${this.masterPrompt}

Genera 5 keywords SEO principales para el siguiente contexto.

CONTEXTO:
${context.slice(0, 2000)}

RESPONDE SOLO EN JSON:
{ "keywords": ["k1","k2","k3","k4","k5"] }`;

    const text = await this.generateText({
      model: MODELS.FLASH,
      prompt,
      temperature: 0.3,
    });

    const parsed = this.extractJSON<KeywordsResponse>(text);
    if (!parsed?.keywords) {
      throw new Error("No se pudieron generar keywords");
    }

    return [...new Set(parsed.keywords)].slice(0, 5);
  }

  async generateArticleOutline(
    topic: string,
    keywords: string[],
    type: ContentType
  ): Promise<Partial<Article>> {
    const prompt = `
${ARTICLE_MASTER_PROMPT}

BUSINESS INPUT
Tema principal: ${topic}
Keywords detectadas: ${keywords.join(", ")}
Idioma: Español (según brief)
Tipo de contenido: ${type}

TASK
Define la estructura completa del artículo cumpliendo TODAS las reglas anteriores.

OUTPUT FORMAT (JSON ONLY):
{
  "title": "H1 en forma de pregunta",
  "metaDescription": "Meta descripción optimizada",
  "sections": [
    {
      "title": "Pregunta H2 1",
      "keywords": ["keyword1", "keyword2"]
    },
    {
      "title": "Pregunta H2 2",
      "keywords": ["keyword3"]
    },
    {
      "title": "Pregunta H2 3",
      "keywords": ["keyword4"]
    },
    {
      "title": "Pregunta H2 4",
      "keywords": ["keyword5"]
    }
  ]
}
`;

    const text = await this.generateText({
      model: MODELS.FLASH,
      prompt,
      temperature: 0.4,
    });

    const parsed = this.extractJSON<Partial<Article>>(text);
    if (!parsed?.sections || !Array.isArray(parsed.sections)) {
      throw new Error("Outline inválido");
    }

    parsed.sections = parsed.sections.map((s, i) => ({
      ...s,
      id: s.id || `section-${i + 1}`,
      content: "",
    }));

    return parsed;
  }

  async generateSectionContent(section: Section, topic: string): Promise<string> {
    // 🔒 NORMALIZACIÓN DEFENSIVA (CLAVE)
    const sectionKeywords =
      Array.isArray(section.keywords)
        ? section.keywords.join(", ")
        : typeof section.keywords === "string"
          ? section.keywords
          : "";

    console.log("[GeminiService][generateSectionContent]", {
      title: section.title,
      rawKeywords: section.keywords,
      normalizedKeywords: sectionKeywords,
    });

    const prompt = `${this.masterPrompt}

CONTEXTO DEL ARTÍCULO:
${topic}

SECCIÓN (H2):
${section.title}

PALABRAS CLAVE DE LA SECCIÓN:
${sectionKeywords}

TAREA:
Redacta el contenido completo de esta sección.

=== ESTRUCTURA Y FORMATO (OBLIGATORIO) ===

Cada sección DEBE incluir:

1. PÁRRAFO INTRODUCTORIO (2-3 oraciones)
   - Responde directamente a la pregunta del H2
   - Introduce el tema de forma clara

2. LISTA CON VIÑETAS (cuando aplique)
   - Usa <ul><li> para enumerar elementos, pasos, beneficios, opciones
   - Mínimo 3 items, máximo 6
   - Cada item: 1-2 oraciones cortas
   - Usa listas SOLO cuando hay 3+ elementos relacionados

3. PÁRRAFO DE CIERRE (1-2 oraciones)
   - Conclusión o llamado a acción suave
   - Conecta con el siguiente tema

CUÁNDO USAR LISTAS:
✅ Enumerar beneficios, características, pasos
✅ Comparar opciones o tratamientos
✅ Listar requisitos o consideraciones
✅ Explicar procesos paso a paso

❌ NO usar listas para:
- Contenido narrativo o explicativo
- Una sola idea o concepto
- Información que fluye mejor en prosa

EJEMPLO DE ESTRUCTURA:

<p>Los tratamientos faciales modernos ofrecen resultados visibles. Existen varias opciones según tus necesidades.</p>

<ul>
<li><strong>Peelings químicos:</strong> Renuevan la piel eliminando células muertas. Son ideales para manchas y textura irregular.</li>
<li><strong>Mesoterapia facial:</strong> Aporta vitaminas y ácido hialurónico. Hidrata en profundidad.</li>
<li><strong>Radiofrecuencia:</strong> Estimula colágeno de forma natural. Tensa la piel sin cirugía.</li>
</ul>

<p>Un especialista evaluará tu caso. Así se elige el tratamiento más adecuado.</p>

=== CRITICAL READABILITY REQUIREMENTS (FLESCH-KINCAID > 60) ===

SENTENCE LENGTH (OBLIGATORIO):
- Máximo 15-20 palabras por oración
- Una oración = Una idea
- Usa puntos, NO comas para separar ideas
- Ejemplo CORRECTO: "Este tratamiento es efectivo. Mejora la piel."
- Ejemplo INCORRECTO: "Este tratamiento es efectivo, mejorando la piel mediante un proceso gradual."

PARAGRAPH STRUCTURE (OBLIGATORIO):
- Máximo 3-4 oraciones por párrafo
- Un párrafo = Un concepto
- Espacios entre párrafos para mejor lectura
- Primera oración responde directamente la pregunta del H2

VOCABULARY (OBLIGATORIO - USA PALABRAS SIMPLES):
- USA: "usar" (NO "utilizar")
- USA: "hacer" (NO "realizar" o "efectuar")
- USA: "mejorar" (NO "optimizar")
- USA: "aumentar" (NO "incrementar")
- USA: "bajar" (NO "disminuir")
- USA: "además" (NO "adicionalmente")
- USA: "después" (NO "posteriormente")
- USA: "cerca de" (NO "aproximadamente")
- Evita jerga técnica innecesaria

SENTENCE STRUCTURE (OBLIGATORIO):
- Usa voz activa: "El médico realiza el procedimiento"
- EVITA voz pasiva: "El procedimiento es realizado por el médico"
- Estructura: Sujeto + Verbo + Objeto
- Evita cláusulas subordinadas cuando sea posible
- Separa ideas complejas en varias oraciones simples

CONNECTORS (OBLIGATORIO - SIMPLIFICA):
- USA: "y", "pero", "porque", "entonces", "por eso"
- EVITA: "mediante", "a través de", "con el fin de", "debido a que"
- EVITA: ", que", ", donde", ", lo cual", ", para que"
- Reemplaza conectores complejos con puntos seguidos

FORMATTING:
- HTML limpio únicamente
- Etiquetas permitidas: <p>, <strong>, <ul>, <li>, <a>
- Usa <strong> con moderación (2-3 términos clave por párrafo)
- Usa listas solo para 3+ elementos similares
- No markdown, no emojis, no datos inventados

EXAMPLES:

❌ MAL (Score bajo):
"La implementación de técnicas avanzadas de rejuvenecimiento facial, las cuales han sido desarrolladas mediante investigación científica rigurosa, permite obtener resultados excepcionales que se mantienen a lo largo del tiempo, proporcionando a los pacientes una apariencia más juvenil."

✅ BIEN (Score alto):
"Los tratamientos faciales modernos usan técnicas científicas probadas. Dan resultados duraderos. Los pacientes lucen más jóvenes. Su piel mejora de forma visible."

TARGET READABILITY:
- Nivel de lectura: 8º grado
- Flesch-Kincaid: 60 o superior (OBLIGATORIO)
- Tono: Conversacional pero profesional
- Claridad sobre complejidad

OBJETIVO FINAL:
Contenido claro, fácil de leer, que resuelva la duda del usuario de forma directa.
SEO + AEO + GEO compatible.
`;

    return this.generateText({
      model: MODELS.FLASH,
      prompt,
      temperature: 0.7,
    });
  }

  async analyzeSEO(content: string, keywords: string[]): Promise<SEOAnalysis> {
    const prompt = `${this.masterPrompt}

Analiza el SEO del siguiente contenido y responde SOLO JSON:
{ "score": 0-100, "suggestions": [] }

CONTENIDO:
${content.slice(0, 3000)}

KEYWORDS:
${keywords.join(", ")}
`;

    const text = await this.generateText({
      model: MODELS.FLASH,
      prompt,
      temperature: 0.2,
    });

    const parsed = this.extractJSON<SEOAnalysis>(text);
    if (!parsed) {
      throw new Error("Análisis SEO inválido");
    }

    return parsed;
  }

  private async validateImageAspectRatio(base64Image: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const img = new Image();

      img.onload = () => {
        const ratio = img.width / img.height;
        const expected = 16 / 9;
        const tolerance = 0.02; // margen aceptable

        if (Math.abs(ratio - expected) > tolerance) {
          reject(
            new Error(
              `Imagen inválida: ${img.width}x${img.height}. Se requiere ratio 16:9`
            )
          );
        } else {
          resolve();
        }
      };

      img.onerror = () =>
        reject(new Error("No se pudo cargar la imagen para validación"));

      img.src = base64Image;
    });
  }

  async generateImage(prompt: string): Promise<string> {
    let lastError: string | null = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`🖼️ Intento ${attempt} de generación de imagen`);

        const result = await this.ai.models.generateContent({
          model: MODELS.IMAGE,
          contents: `
IMPORTANT IMAGE CONSTRAINTS (MANDATORY):
- Horizontal image
- Aspect ratio 16:9
- Editorial photography style
- No logos
- No text
- No watermarks

${prompt}
        `,
        });

        const parts =
          (result as any)?.candidates?.[0]?.content?.parts ?? [];

        const imagePart = parts.find(
          (p: any) => p.inlineData?.mimeType?.startsWith("image/")
        );

        if (!imagePart?.inlineData?.data) {
          throw new Error("No image data returned by model");
        }

        const base64Image = `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;

        // ✅ ÚNICA VALIDACIÓN REAL
        await this.validateImageAspectRatio(base64Image);

        console.log("✅ Imagen válida (16:9) generada");
        return base64Image;

      } catch (error: any) {
        lastError = error.message;
        console.error("❌ Error en intento de imagen:", error);
      }
    }

    throw new Error(
      `No se pudo generar una imagen válida tras 3 intentos. Último error: ${lastError}`
    );
  }
}

/* ======================================================
   EXPORT
====================================================== */

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;

const geminiService = new GeminiService(API_KEY || "");

export const generateKeywords =
  geminiService.generateKeywords.bind(geminiService);
export const generateArticleOutline =
  geminiService.generateArticleOutline.bind(geminiService);
export const generateSectionContent =
  geminiService.generateSectionContent.bind(geminiService);
export const analyzeSEO =
  geminiService.analyzeSEO.bind(geminiService);
export const generateImage =
  geminiService.generateImage.bind(geminiService);

export default geminiService;