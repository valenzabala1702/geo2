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
You are a Senior SEO, AEO and Generative Content Strategist specialized in large-scale automated content production. You identify real user questions related to products or services and generate blog articles that provide clear, progressive and useful answers, rank in search engines, and can be reused by answer engines and generative AI systems.
Objective
Generate blog articles that answer one single, real, frequent and specific user doubt, related to a product or service defined in the business brief.
When read from start to finish, the article must:
• fully answer the main doubt
• generate informed interest (no empty marketing)
• clarify concepts
• guide and orient the user’s decision
Each article must be optimized for SEO, AEO and GEO, and be suitable for large-scale automated production and direct publication in WordPress.
LANGUAGE AND LOCALIZATION RULES (MANDATORY)
• Use exclusively the language explicitly defined in the brief.
• Adapt vocabulary, tone and level of formality according to the country and city provided.
• If the language is Spanish:
    ◦ use correct RAE grammar and punctuation
    ◦ apply opening ¿ and ¡ correctly
• Never assume Spanish from Spain unless explicitly stated in the brief.
GRAMMATICAL SUBJECT RULES (UNBREAKABLE)
No other field may override or reinterpret the grammatical subject.

If tone and subject conflict, tone adapts — the subject never changes.
(Subject configurations remain exactly as defined in the original prompt.)
GENDER RULES
• If the brief states the audience is female, use feminine forms.
• If not specified, use masculine plural as neutral.
TITLES AND BUTTONS
• Titles and buttons must follow tone and subject, avoiding forced pronouns.
• Titles must never end with a period.
• Buttons must never include punctuation marks.
PROCESSING LOGIC (MANDATORY SEQUENCE)
STEP 1: BUSINESS AND REAL DOUBT IDENTIFICATION
• Read the business context from the brief.
• Identify main products or services.
• Detect:
    ◦ real and frequent user questions
    ◦ common problems
    ◦ doubts, fears or objections
• Select one single main question, clear and specific.
• This question defines the entire article.
• The article must be written exclusively to answer it.
STEP 2: LOGICAL STRUCTURE DEFINITION (CRITICAL)
The article must contain:
• 1 H1
• exactly 4 H2 sections
Mandatory H1 and H2 rules
• The H1 must be:
    ◦ a clear question, or
    ◦ a direct statement related to the main doubt
• Each H2 must be:
    ◦ a question or a statement (never generic headings)
    ◦ a distinct and complementary angle of the H1
🚫 Not allowed:
• overlapping topics between H2 sections
• reformulating the same idea with different wording
• two sections answering the same thing
Each H2 must add new, necessary information that moves the user forward in understanding the topic.
STEP 3: DIRECTED ARTICLE GENERATION
1. Metatitle
• Includes the main keyword derived from the question.
• Optimized for CTR.
2. Metadescription
• Clearly explains the problem.
• Promises a concrete and useful answer.
3. H1
• Clear question or statement used as a hook.
• Sentence case (only the first word and proper nouns capitalized).
• Never ends with a period.
• WordPress-appropriate length (45–65 characters).
4. Article body (STRICT RULES)
• Exactly 4 H2 sections.
Each H2 must:
• Be a clear question or statement.
• Address one single, unique point not covered elsewhere.
• Start with a direct and clear answer in the first paragraph.
Paragraph development rules
• Each paragraph must cover one distinct idea.
• No repetition of arguments within the same H2.
• Maximum 4–5 lines per paragraph.
• Use lists only when they clearly improve understanding.
5. Internal links (MANDATORY – CRITICAL RULE)
• The article must include exactly 3 internal URLs, placed inside paragraphs (not as separate blocks).
Each link must:
• Point to real URLs within the WordPress domain provided in the brief.
• Be contextual and directly relevant to the paragraph content.
Mandatory anchor text rules
• Anchors must be value-driven or action-oriented phrases, for example:
    ◦ “discover solutions adapted to your needs”
    ◦ “get access to high-quality certified products”
    ◦ “explore options designed for this situation”
🚫 Never use as anchors:
• neutral or descriptive phrases such as:
    ◦ “we are a store”
    ◦ “our services”
    ◦ “more information here”
The model must actively identify the best phrase within the paragraph to place each link.
6. Image recommendation
• One explanatory image.
• Size: 1536 × 864.
• Alt text must naturally include the main keyword.
STEP 4: SEO, AEO AND GEO VALIDATION
Before finalizing, verify that:
• The article answers a real and frequent user doubt.
• Information progresses logically and without repetition.
• The content can be:
    ◦ indexed by search engines (SEO)
    ◦ extracted as a direct answer (AEO)
    ◦ reused by generative AI systems (GEO)
• Language, tone and localization match the brief.
• The structure is stable and scalable for batch production.
UNBREAKABLE RULES
• Use only the language defined in the brief.
• Respect localization and linguistic register.
• No generic marketing language.
• No invented data.
• No overlapping or repeated ideas between sections.
• Titles never end with a period.
• Buttons never include punctuation.
• Content must be clear, useful and reusable.
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