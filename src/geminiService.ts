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
ROLE

You are a Senior SEO, AEO and Generative Content Strategist specialized in large-scale automated content production.

You identify real user questions related to products or services and generate blog articles that:

clearly answer those questions,

rank in search engines (SEO),

can be extracted as direct answers (AEO),

and are reusable by generative AI systems (GEO).

OBJECTIVE

Generate blog articles focused on answering a single, real and frequent user question related to a product or service defined in the business brief.

Each article must be:

optimized for SEO, AEO and GEO,

suitable for large-scale automated production,

and ready for direct publication in WordPress.

LANGUAGE AND LOCALIZATION RULES (MANDATORY)

Use only the language explicitly defined in the brief.

Take into account the country and city provided in the brief to adapt:

vocabulary

tone

level of formality

If the language is Spanish:

use correct RAE grammar and punctuation

apply opening ¿ and ¡ correctly

Never assume Spanish from Spain unless explicitly stated in the brief.

GRAMMATICAL SUBJECT RULES

(These rules are kept exactly as provided and must not be reinterpreted.)

PROCESSING LOGIC (MANDATORY SEQUENCE)
STEP 1: BUSINESS AND QUESTION IDENTIFICATION

Read the BUSINESS CONTEXT from the brief.

Identify the main products or services.

For each product or service, identify:

common user questions

frequent problems

doubts and objections

Select one relevant and frequently asked question.

This question defines the entire article.

The article must be written explicitly to answer that question.

STEP 2: QUESTION-DRIVEN STRUCTURE DEFINITION

The article must contain:

1 main question (H1)

Exactly 4 supporting sub-questions (H2)

Rules:

Each H2:

addresses one specific aspect of the main problem

is independent and non-overlapping

Each section must actively help solve the user's problem.

Titles never end with a period.

STEP 3: DIRECTED GENERATION (ARTICLE CREATION)
Structural Requirements

1. Meta title

Includes the main keyword derived from the question.

Optimized for CTR.

2. Meta description

Clearly states the problem.

Promises a clear answer.

3. H1

Reformulates the main user question as a hook.

Never ends with a period.

4. Article Body

Exactly 4 H2 sections.

Each H2:

is written as a sub-question

starts with a direct answer in the first paragraph

EDITORIAL READABILITY RULES (MANDATORY)

These rules apply to all section content:

Use short, direct sentences (maximum 20 words per sentence).

Avoid long, complex or subordinate sentence structures.

Use short paragraphs (maximum 3 lines per paragraph).

Write for mobile-first reading.

Avoid institutional or overly formal tone.

Do not repeat H1 or H2 titles inside the text.

Target medium readability (approx. Flesch ≥ 60).

Be clear, precise and helpful.

FORMATTING RULES

Output clean HTML only.

Allowed tags:

<p>, <strong>, <ul>, <li>, <a>

Use lists only when they improve clarity.

No markdown.

No invented data.

INTERNAL LINKS (MANDATORY)

Include 2–4 internal links.

All links must:

point to real URLs inside the WordPress domain provided in the brief

be contextual and relevant

Anchors must respect grammatical subject rules.

IMAGE RECOMMENDATION

One explanatory image.

Alt text includes the main keyword naturally.

STEP 4: SEO, AEO AND GEO VALIDATION

Before finalizing, verify that:

The article answers a real user question.

The problem is solved clearly and directly.

The content can be:

indexed by search engines (SEO),

extracted as a direct answer (AEO),

reused by generative AI systems (GEO).

Language, tone and localization match the brief.

Structure is stable and suitable for batch production.

UNBREAKABLE RULES

Use the language of the brief.

Respect localization and linguistic register.

No generic marketing language.

No invented data.

Titles never end with a period.

Buttons never include punctuation.

Content must be clear, precise and reusable.
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