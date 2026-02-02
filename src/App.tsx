import React, { useState } from 'react';
import { AppStep, Article, Section, ContentType } from './types';
import { 
  generateArticleOutline, 
  generateSectionContent, 
  analyzeSEO, 
  generateKeywords, 
  generateImage 
} from './geminiService';

// 📄 Fila de producción SEO desde CSV
interface CsvRow {
  account_uuid: string;
  kw: string;  // Keywords separadas por comas
  task_count: number;  // Número de artículos a generar
  task_clickup_ids: string;  // IDs de ClickUp separados por comas
}

// 🔧 Normaliza cualquier imagen base64 a 1536×864 usando canvas
const resizeImageTo1536x864 = (base64Image: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 1536;
      canvas.height = 864;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("No se pudo obtener contexto canvas"));
        return;
      }

      const imgRatio = img.width / img.height;
      const targetRatio = 1536 / 864;

      let sx = 0;
      let sy = 0;
      let sw = img.width;
      let sh = img.height;

      if (imgRatio > targetRatio) {
        sw = img.height * targetRatio;
        sx = (img.width - sw) / 2;
      } else {
        sh = img.width / targetRatio;
        sy = (img.height - sh) / 2;
      }

      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, 1536, 864);

      resolve(canvas.toDataURL("image/jpeg", 0.95));
    };

    img.onerror = () =>
      reject(new Error("No se pudo cargar la imagen para redimensionar"));

    img.src = base64Image;
  });
};

// 🌐 Extrae la web del cliente desde el TEXTO visible (no imágenes)
const extractWebsiteFromBriefHTML = (html: string): string | null => {
  // 1️⃣ Aislamos la sección "¿Tienes página web?"
  const sectionMatch = html.match(
    /¿Tienes página web\?[\s\S]*?<p>([\s\S]*?)<\/p>/i
  );

  if (!sectionMatch) return null;

  // 2️⃣ Eliminamos cualquier <img> o tag HTML
  const textOnly = sectionMatch[1]
    .replace(/<img[\s\S]*?>/gi, "")
    .replace(/<[^>]+>/g, "")
    .trim();

  // 3️⃣ Extraemos el dominio desde el TEXTO
  const domainMatch = textOnly.match(
    /\b((https?:\/\/)?([a-z0-9-]+\.)+(com|es|net|org|clinic|health|med|co))\b/i
  );

  if (!domainMatch) return null;

  const domain = domainMatch[1];

  return domain.startsWith("http") ? domain : `https://${domain}`;
};

/**
 * Genera 3 enlaces internos estándar del dominio del cliente
 * Estructura universal: home, blog, contacto
 */
const generateClientInternalLinks = (domain: string): string[] => {
  const base = domain.replace(/\/$/, "");

  return [
    `${base}/`,           // Home
    `${base}/blog`,       // Blog
    `${base}/contacto`    // Contacto
  ];
};

const insertInternalLinksIntoSections = (
  sections: Section[],
  links: string[]
): Section[] => {
  if (!links.length || links.length < 3) {
    console.warn("⚠️ Se requieren al menos 3 enlaces internos");
    return sections;
  }

  const linksToInsert = links.slice(0, 3);
  let insertedCount = 0;

  // ✅ PASADA 1: Párrafos largos - Anchor de 5-8 palabras (frases coherentes)
  let updatedSections = sections.map((section, sectionIndex) => {
    if (insertedCount >= 3 || !section.content) return section;

    const paragraphMatches = section.content.match(/<p>[\s\S]*?<\/p>/g);
    if (!paragraphMatches || paragraphMatches.length === 0) return section;

    for (const p of paragraphMatches) {
      const textOnly = p.replace(/<[^>]+>/g, '').trim();
      const words = textOnly.split(/\s+/).filter(w => w.length > 0);
      
      if (words.length >= 15) {
        // Para párrafos largos, usar frase de 5-8 palabras
        const midPoint = Math.floor(words.length / 2);
        const anchorStart = Math.max(0, midPoint - 3);
        const anchorLength = Math.min(7, words.length - anchorStart);
        const anchorEnd = anchorStart + anchorLength;
        const anchorText = words.slice(anchorStart, anchorEnd).join(' ');

        const beforeAnchor = words.slice(0, anchorStart).join(' ');
        const afterAnchor = words.slice(anchorEnd).join(' ');
        
        const linkHtml = `<a href="${linksToInsert[insertedCount]}" target="_blank" rel="noopener noreferrer">${anchorText}</a>`;
        const parts = [beforeAnchor, linkHtml, afterAnchor].filter(pt => pt.trim().length > 0);
        const newParagraph = `<p>${parts.join(' ')}</p>`;

        section.content = section.content.replace(p, newParagraph);
        insertedCount++;
        console.log(`[Enlaces] ✓ Enlace ${insertedCount}/3 (pasada 1 - frase larga) en sección ${sectionIndex}`);
        console.log(`[Enlaces]   Anchor: "${anchorText}"`);
        break;
      }
    }

    return section;
  });

  // ✅ PASADA 2: Párrafos medianos - Anchor de 4-6 palabras
  if (insertedCount < 3) {
    console.log(`[Enlaces] Pasada 2: Solo ${insertedCount}/3. Buscando frases medianas...`);
    
    updatedSections = updatedSections.map((section, sectionIndex) => {
      if (insertedCount >= 3 || !section.content) return section;
      if (section.content.includes('<a href=')) return section;

      const paragraphMatches = section.content.match(/<p>[\s\S]*?<\/p>/g);
      if (!paragraphMatches) return section;

      for (const p of paragraphMatches) {
        const textOnly = p.replace(/<[^>]+>/g, '').trim();
        const words = textOnly.split(/\s+/).filter(w => w.length > 0);
        
        if (words.length >= 10) {
          const midPoint = Math.floor(words.length / 2);
          const anchorStart = Math.max(0, midPoint - 2);
          const anchorLength = Math.min(5, words.length - anchorStart);
          const anchorEnd = anchorStart + anchorLength;
          const anchorText = words.slice(anchorStart, anchorEnd).join(' ');

          const beforeAnchor = words.slice(0, anchorStart).join(' ');
          const afterAnchor = words.slice(anchorEnd).join(' ');
          
          const linkHtml = `<a href="${linksToInsert[insertedCount]}" target="_blank" rel="noopener noreferrer">${anchorText}</a>`;
          const parts = [beforeAnchor, linkHtml, afterAnchor].filter(pt => pt.trim().length > 0);
          const newParagraph = `<p>${parts.join(' ')}</p>`;

          section.content = section.content.replace(p, newParagraph);
          insertedCount++;
          console.log(`[Enlaces] ✓ Enlace ${insertedCount}/3 (pasada 2 - frase media) en sección ${sectionIndex}`);
          console.log(`[Enlaces]   Anchor: "${anchorText}"`);
          break;
        }
      }

      return section;
    });
  }

  // ✅ PASADA 3: Párrafos cortos - Anchor de 3-4 palabras
  if (insertedCount < 3) {
    console.log(`[Enlaces] Pasada 3: Solo ${insertedCount}/3. Aceptando frases cortas...`);
    
    updatedSections = updatedSections.map((section, sectionIndex) => {
      if (insertedCount >= 3 || !section.content) return section;
      if (section.content.includes('<a href=')) return section;

      const paragraphMatches = section.content.match(/<p>[\s\S]*?<\/p>/g);
      if (!paragraphMatches) return section;

      for (const p of paragraphMatches) {
        const textOnly = p.replace(/<[^>]+>/g, '').trim();
        const words = textOnly.split(/\s+/).filter(w => w.length > 0);
        
        if (words.length >= 6) {
          const midPoint = Math.floor(words.length / 2);
          const anchorStart = Math.max(0, midPoint - 1);
          const anchorEnd = Math.min(words.length, anchorStart + 4);
          const anchorText = words.slice(anchorStart, anchorEnd).join(' ');

          const beforeAnchor = words.slice(0, anchorStart).join(' ');
          const afterAnchor = words.slice(anchorEnd).join(' ');
          
          const linkHtml = `<a href="${linksToInsert[insertedCount]}" target="_blank" rel="noopener noreferrer">${anchorText}</a>`;
          const parts = [beforeAnchor, linkHtml, afterAnchor].filter(pt => pt.trim().length > 0);
          const newParagraph = `<p>${parts.join(' ')}</p>`;

          section.content = section.content.replace(p, newParagraph);
          insertedCount++;
          console.log(`[Enlaces] ✓ Enlace ${insertedCount}/3 (pasada 3) en sección ${sectionIndex}`);
          break;
        }
      }

      return section;
    });
  }

  // ✅ PASADA 4: MODO DESESPERADO - Frases naturales al final del párrafo
  if (insertedCount < 3) {
    console.log(`[Enlaces] Pasada 4 (DESESPERADA): Solo ${insertedCount}/3. Insertando frases al final...`);
    
    // Frases naturales según el tipo de enlace
    const anchorTexts = [
      "conoce más sobre nuestros servicios",
      "encuentra información útil en nuestro blog",
      "agenda una consulta personalizada"
    ];
    
    updatedSections = updatedSections.map((section, sectionIndex) => {
      if (insertedCount >= 3 || !section.content) return section;

      const paragraphMatches = section.content.match(/<p>[\s\S]*?<\/p>/g);
      if (!paragraphMatches || paragraphMatches.length === 0) return section;

      for (const p of paragraphMatches) {
        if (p.includes('<a href=')) continue;
        
        const textOnly = p.replace(/<\/?p>/g, '').trim();
        
        // Insertar frase natural al final
        const anchorText = anchorTexts[insertedCount];
        const newParagraph = `<p>${textOnly}. Puedes <a href="${linksToInsert[insertedCount]}" target="_blank" rel="noopener noreferrer">${anchorText}</a></p>`;

        section.content = section.content.replace(p, newParagraph);
        insertedCount++;
        console.log(`[Enlaces] ✓ Enlace ${insertedCount}/3 (pasada 4 - forzado) en sección ${sectionIndex}`);
        break;
      }

      return section;
    });
  }

  console.log(`[Enlaces] ======================================`);
  console.log(`[Enlaces] RESULTADO FINAL: ${insertedCount} de 3 enlaces`);
  console.log(`[Enlaces] ======================================`);
  
  return updatedSections;
};

// 📖 Mejora automática de legibilidad (Readability Boost)
// Objetivo: Flesch-Kincaid > 60 (OK to Easy)
const improveReadability = (html: string): string => {
  if (!html) return html;

  let improved = html;

  // 1️⃣ Divide oraciones largas (más de 20 palabras)
  improved = improved.replace(/<p>(.*?)<\/p>/g, (_match, text) => {
    const sentences = text.split(/\.\s+/);
    const processedSentences = sentences.map(sentence => {
      const words = sentence.trim().split(/\s+/);
      
      // Si la oración tiene más de 20 palabras, dividirla
      if (words.length > 20) {
        const midPoint = Math.floor(words.length / 2);
        const firstPart = words.slice(0, midPoint).join(' ');
        const secondPart = words.slice(midPoint).join(' ');
        return `${firstPart}. ${secondPart}`;
      }
      
      return sentence;
    });
    
    return `<p>${processedSentences.join('. ').trim()}</p>`;
  });

  // 2️⃣ Rompe párrafos muy largos (más de 4 oraciones)
  improved = improved.replace(/<p>(.*?)<\/p>/g, (_match, text) => {
    const sentences = text.split(/\.\s+/).filter(s => s.trim());
    
    if (sentences.length > 4) {
      const mid = Math.ceil(sentences.length / 2);
      const firstParagraph = sentences.slice(0, mid).join('. ') + '.';
      const secondParagraph = sentences.slice(mid).join('. ') + '.';
      return `<p>${firstParagraph}</p><p>${secondParagraph}</p>`;
    }
    
    return `<p>${text}</p>`;
  });

  // 3️⃣ Simplifica conectores complejos
  const complexConnectors: Record<string, string> = {
    ', que ': '. ',
    ', donde ': '. ',
    ', mediante ': '. ',
    ', para que ': '. Para ',
    ', lo que ': '. Esto ',
    ', el cual ': '. Este ',
    ', la cual ': '. Esta ',
    ', los cuales ': '. Estos ',
    ', las cuales ': '. Estas ',
    'debido a que': 'porque',
    'a pesar de que': 'aunque',
    'con el fin de': 'para',
    'en el caso de que': 'si',
    'de tal manera que': 'así',
  };

  Object.entries(complexConnectors).forEach(([complex, simple]) => {
    const regex = new RegExp(complex, 'gi');
    improved = improved.replace(regex, simple);
  });

  // 4️⃣ Acorta palabras complejas comunes
  const wordSimplifications: Record<string, string> = {
    'utilizar': 'usar',
    'efectuar': 'hacer',
    'realizar': 'hacer',
    'implementar': 'aplicar',
    'optimizar': 'mejorar',
    'incrementar': 'aumentar',
    'disminuir': 'bajar',
    'adicionalmente': 'además',
    'posteriormente': 'después',
    'anteriormente': 'antes',
    'aproximadamente': 'cerca de',
    'específicamente': 'en concreto',
  };

  Object.entries(wordSimplifications).forEach(([complex, simple]) => {
    const regex = new RegExp(`\\b${complex}\\b`, 'gi');
    improved = improved.replace(regex, simple);
  });

  // 5️⃣ Limpia espacios y puntuación redundante
  improved = improved.replace(/\s{2,}/g, ' ');
  improved = improved.replace(/\.{2,}/g, '.');
  improved = improved.replace(/\.\s*\./g, '.');
  
  // 6️⃣ Asegura espacio después de puntos
  improved = improved.replace(/\.([A-Z])/g, '. $1');

  return improved;
};

const App: React.FC = () => {
  // Configuración de Estados
  const [step, setStep] = useState<AppStep>(AppStep.AUTH);
  const [authToken, setAuthToken] = useState('');
  const [accountUuid, setAccountUuid] = useState('');

  const [isManualMode, setIsManualMode] = useState(false); // false = EXTRACCIÓN AUTO, true = CARGA MASIVA CSV
  
  const [loadingStatus, setLoadingStatus] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  
  // Datos del Proceso
  const [article, setArticle] = useState<Partial<Article>>({});
  const [keywords, setKeywords] = useState<string[]>([]);
  const [newKeyword, setNewKeyword] = useState('');
  const [logs, setLogs] = useState<string[]>([]);
  const [publishResult, setPublishResult] = useState<{ success: boolean; msg: string; url?: string } | null>(null);

  // 📄 Producción masiva desde CSV
  const [csvRows, setCsvRows] = useState<CsvRow[]>([]);
  const [currentRowIndex, setCurrentRowIndex] = useState(0);
  const [batchProgress, setBatchProgress] = useState<{
    currentAccount: number;
    totalAccounts: number;
    currentArticle: number;
    totalArticles: number;
    publishedUrls: string[];
    isComplete: boolean;
    currentAccountUuid?: string; // UUID de la cuenta actual
  }>({
    currentAccount: 0,
    totalAccounts: 0,
    currentArticle: 0,
    totalArticles: 0,
    publishedUrls: [],
    isComplete: false
  });

  const [clientWebsite, setClientWebsite] = useState<string | null>(null);

  // 🧠 Memoria de títulos generados por cuenta (para evitar duplicados)
  const [accountMemory, setAccountMemory] = useState<Record<string, string[]>>({});

  // 📋 Capturar URLs publicadas automáticamente en modo CSV
  React.useEffect(() => {
    // Solo en modo CSV y si la publicación fue exitosa
    if (batchProgress.totalAccounts > 0 && publishResult?.success && publishResult.url) {
      // Verificar si la URL ya está en el array (evitar duplicados)
      if (!batchProgress.publishedUrls.includes(publishResult.url)) {
        setBatchProgress(prev => ({
          ...prev,
          publishedUrls: [...prev.publishedUrls, publishResult.url!]
        }));
        addLog(`✅ URL guardada en resumen: ${publishResult.url}`);
      }
    }
  }, [publishResult]); // Se ejecuta cada vez que publishResult cambia

  const addLog = (msg: string) => {
    setLogs(prev => [...prev.slice(-25), `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  const wait = (ms: number) => new Promise(res => setTimeout(res, ms));

  // 🔗 Actualizar campo de URL en ClickUp
  const updateClickUpTaskUrl = async (taskId: string, url: string): Promise<boolean> => {
    try {
      addLog(`🔄 Actualizando ClickUp task ${taskId} con URL...`);
      
      const response = await fetch(`https://api.clickup.com/api/v2/task/${taskId}/field/959a5bb5-b1ac-44ec-b814-52f7b415ac91`, {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'content-type': 'application/json',
          'Authorization': 'pk_88229489_VXTU9J94MUYGDPXQ80XHST6KY6FIK1XH'
        },
        body: JSON.stringify({ value: url })
      });

      if (!response.ok) {
        throw new Error(`Error ${response.status}: ${await response.text()}`);
      }

      addLog(`✅ URL poblada en ClickUp task ${taskId}`);
      return true;
    } catch (e: any) {
      addLog(`❌ Error poblando URL en ClickUp: ${e.message}`);
      return false;
    }
  };

  // ✅ Marcar tarea de ClickUp como completada
  const markClickUpTaskComplete = async (taskId: string): Promise<boolean> => {
    try {
      addLog(`🔄 Marcando ClickUp task ${taskId} como completada...`);
      
      const response = await fetch(`https://api.clickup.com/api/v2/task/${taskId}/field/b39da2a6-e438-4786-aaa6-9774e49bfcc4?custom_task_ids=true`, {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'content-type': 'application/json',
          'Authorization': 'pk_88229489_VXTU9J94MUYGDPXQ80XHST6KY6FIK1XH'
        }
      });

      if (!response.ok) {
        throw new Error(`Error ${response.status}: ${await response.text()}`);
      }

      addLog(`✅ ClickUp task ${taskId} marcada como completada`);
      return true;
    } catch (e: any) {
      addLog(`❌ Error marcando tarea: ${e.message}`);
      return false;
    }
  };

  // 📋 Actualizar todas las tareas de ClickUp con las URLs generadas
  const updateClickUpTasks = async () => {
    if (csvRows.length === 0 || batchProgress.publishedUrls.length === 0) {
      addLog("❌ No hay URLs o filas CSV para actualizar");
      return;
    }

    addLog(`\n========================================`);
    addLog(`📋 ACTUALIZANDO CLICKUP`);
    addLog(`========================================`);

    setIsLoading(true);
    setLoadingStatus("Actualizando tareas en ClickUp...");

    let urlIndex = 0;
    let successCount = 0;

    try {
      for (const row of csvRows) {
        // Parsear los task IDs de ClickUp
        const taskIds = row.task_clickup_ids
          .split(',')
          .map(id => id.trim())
          .filter(id => id.length > 0);

        if (taskIds.length === 0) {
          addLog(`⚠️ No hay task IDs para cuenta ${row.account_uuid.slice(0, 12)}...`);
          continue;
        }

        addLog(`\n📦 Procesando ${taskIds.length} tareas de ClickUp...`);

        // Actualizar cada task con su URL correspondiente
        for (let i = 0; i < taskIds.length; i++) {
          if (urlIndex >= batchProgress.publishedUrls.length) {
            addLog(`⚠️ No hay más URLs disponibles`);
            break;
          }

          const taskId = taskIds[i];
          const url = batchProgress.publishedUrls[urlIndex];

          addLog(`\n🎯 Task ${i + 1}/${taskIds.length}: ${taskId}`);

          // 1. Poblar URL
          const urlSuccess = await updateClickUpTaskUrl(taskId, url);
          await wait(500);

          if (urlSuccess) {
            // 2. Marcar como completada
            const completeSuccess = await markClickUpTaskComplete(taskId);
            await wait(500);

            if (completeSuccess) {
              successCount++;
            }
          }

          urlIndex++;
        }
      }

      addLog(`\n========================================`);
      addLog(`✅ ACTUALIZACIÓN COMPLETADA`);
      addLog(`========================================`);
      addLog(`📊 ${successCount} tareas actualizadas exitosamente`);

      // Mostrar mensaje de éxito
      alert(`✅ ClickUp actualizado:\n\n${successCount} tareas actualizadas correctamente`);

    } catch (e: any) {
      addLog(`❌ Error general: ${e.message}`);
      alert(`Error actualizando ClickUp:\n\n${e.message}`);
    } finally {
      setIsLoading(false);
      setLoadingStatus("");
    }
  };

  // 📄 Parser CSV robusto que maneja valores con comas entre comillas
  const parseCSVLine = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let insideQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (char === '"') {
        insideQuotes = !insideQuotes;
      } else if (char === ',' && !insideQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    
    result.push(current.trim());
    return result;
  };

  // 📄 Carga y lectura de CSV para producción masiva
  const handleCsvUpload = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    addLog("📄 Leyendo archivo CSV...");

    const text = await file.text();
    const lines = text.split("\n").filter(line => line.trim().length > 0);

    if (lines.length < 2) {
      alert("El archivo CSV está vacío o no tiene datos.");
      return;
    }

    // Parsear headers
    const headers = parseCSVLine(lines[0]).map(h => h.trim().toLowerCase().replace(/"/g, ''));
    
    addLog(`📋 Columnas detectadas: ${headers.join(", ")}`);
    
    // Verificar que existan las columnas requeridas
    const requiredColumns = ['account_uuid', 'kw', 'task_count', 'task_clickup_ids'];
    const missingColumns = requiredColumns.filter(col => !headers.includes(col));
    
    if (missingColumns.length > 0) {
      alert(`Faltan columnas requeridas en el CSV: ${missingColumns.join(', ')}\n\nColumnas encontradas: ${headers.join(', ')}`);
      return;
    }

    const rows: CsvRow[] = lines.slice(1).map((line, lineNum) => {
      // Usar parser robusto
      const values = parseCSVLine(line).map(v => v.trim().replace(/^"|"$/g, ''));

      const accountUuid = values[headers.indexOf("account_uuid")] || "";
      const kw = values[headers.indexOf("kw")] || "";
      const taskCountStr = values[headers.indexOf("task_count")] || "1";
      const taskCount = parseInt(taskCountStr, 10);
      const taskClickupIds = values[headers.indexOf("task_clickup_ids")] || "";

      return {
        account_uuid: accountUuid,
        kw: kw,
        task_count: isNaN(taskCount) || taskCount <= 0 ? 1 : taskCount,
        task_clickup_ids: taskClickupIds,
      };
    }).filter(row => row.account_uuid && row.kw);

    if (rows.length === 0) {
      alert("No se encontraron filas válidas en el CSV.");
      return;
    }

    setCsvRows(rows);
    setCurrentRowIndex(0);

    const totalArticles = rows.reduce((sum, row) => sum + row.task_count, 0);
    
    addLog(`✅ CSV cargado: ${rows.length} cuentas válidas`);
    addLog(`📊 Total artículos: ${totalArticles}`);
    
    // Mostrar detalle de cada fila
    rows.forEach((row, i) => {
      addLog(`  Cuenta ${i + 1}: ${row.task_count} artículos | UUID: ${row.account_uuid.slice(0, 12)}... | KW: ${row.kw.slice(0, 40)}...`);
    });
  };

  /**
   * Utilidad para convertir base64 a Blob para subir a WP
   */
  const base64ToBlob = (base64: string, contentType: string) => {
    const byteCharacters = atob(base64.split(',')[1]);
    const byteArrays = [];
    for (let offset = 0; offset < byteCharacters.length; offset += 512) {
      const slice = byteCharacters.slice(offset, offset + 512);
      const byteNumbers = new Array(slice.length);
      for (let i = 0; i < slice.length; i++) {
        byteNumbers[i] = slice.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      byteArrays.push(byteArray);
    }
    return new Blob(byteArrays, { type: contentType });
  };

  /**
   * Sube la imagen a la biblioteca de medios de WordPress
   */
  const uploadImageToWP = async (base64: string, title: string, token: string): Promise<number | null> => {
    try {
      addLog("Subiendo imagen a WordPress Media...");
      const blob = base64ToBlob(base64, 'image/png');
      const formData = new FormData();
      formData.append('file', blob, `seo-image-${Date.now()}.png`);
      formData.append('title', title);
      formData.append('alt_text', title);

      const response = await fetch("https://masproposals.com/wp-json/wp/v2/media", {
        method: 'POST',
        headers: { 
          'Authorization': token 
        },
        body: formData
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Error subiendo imagen");
      }

      const media = await response.json();
      addLog(`Imagen subida con éxito (ID: ${media.id})`);
      return media.id;
    } catch (e: any) {
      addLog(`Error subiendo imagen: ${e.message}`);
      return null;
    }
  };

  const extractContextFromData = (data: any): string => {
    /**
     * ============================
     * CASO 1: HTML (web del cliente)
     * ============================
     */
    if (typeof data === 'string' && data.includes('<')) {
      const doc = new DOMParser().parseFromString(data, 'text/html');

      // ❌ Eliminamos ruido visual / legal
      doc.querySelectorAll(
        'nav, header, footer, script, style, img, svg, button, form, input, aside'
      ).forEach(el => el.remove());

      const chunks: string[] = [];

      // ✅ Prioridad a títulos reales
      doc.querySelectorAll('h1, h2, h3').forEach(el => {
        const text = el.textContent?.trim();
        if (text && text.length > 5) chunks.push(text);
      });

      // ✅ Prioridad a párrafos con contenido semántico
      doc.querySelectorAll('p').forEach(el => {
        const text = el.textContent?.trim();
        if (text && text.length > 80) chunks.push(text);
      });

      const context = chunks
        .filter((v, i, a) => a.indexOf(v) === i)
        .join('. ')
        .slice(0, 12000);

      addLog("🧠 Contexto HTML limpio generado");
      addLog("📄 Preview contexto HTML:");
      addLog(context.slice(0, 400) + "...");

      return context;
    }

    /**
     * ============================
     * CASO 2: JSON (brief estructurado)
     * ============================
     */
    if (typeof data === 'object' && data !== null) {
      const chunks: string[] = [];

      // 🔑 SOLO campos que definen negocio
      const PRIORITY_KEYS = [
        'business_name',
        'company_name',
        'brand',
        'service',
        'services',
        'description',
        'business_description',
        'about',
        'objectives',
        'target_audience',
        'value_proposition',
        'notes'
      ];

      const walk = (obj: any) => {
        if (!obj || typeof obj !== 'object') return;

        Object.entries(obj).forEach(([key, value]) => {
          if (PRIORITY_KEYS.includes(key) && typeof value === 'string') {
            chunks.push(value);
          } else if (typeof value === 'object') {
            walk(value);
          }
        });
      };

      walk(data);

      const context = chunks
        .filter((v, i, a) => a.indexOf(v) === i)
        .join('. ')
        .slice(0, 12000);

      addLog("🧠 Contexto JSON estructurado generado");
      addLog("📄 Preview contexto JSON:");
      addLog(context.slice(0, 400) + "...");

      return context;
    }

    /**
     * ============================
     * FALLBACK
     * ============================
     */
    return String(data).slice(0, 5000);
  };

  const handleDataAcquisition = async (data: any, skipKeywordsAndStep: boolean = false): Promise<string | null> => {
    addLog("Interpretando información del Brief...");
    const context = extractContextFromData(data);

    let detectedWebsite: string | null = null;

    // 🌐 DETECCIÓN DE WEB DEL CLIENTE (solo si el brief es HTML)
    if (typeof data === "string") {
      const website = extractWebsiteFromBriefHTML(data);

      if (website) {
        setClientWebsite(website);
        detectedWebsite = website;
        addLog(`🌐 Web del cliente detectada: ${website}`);
      } else {
        setClientWebsite(null);
        addLog("ℹ️ El brief no contiene web del cliente");
      }
    }
    
    addLog("📤 Contexto FINAL enviado a Gemini:");
    addLog(context.slice(0, 500));

    // Solo generar keywords y cambiar step si NO se indica lo contrario
    if (!skipKeywordsAndStep) {
      setIsLoading(true);
      setLoadingStatus("IA extrayendo datos del Brief...");
      try {
        const suggestedKeywords = await generateKeywords(context);
        setKeywords(suggestedKeywords);
        addLog(`Keywords identificadas: ${suggestedKeywords.join(", ")}`);
        setStep(AppStep.KEYWORDS);
      } catch (e: any) {
        addLog(`Error Gemini: ${e.message}`);
        setKeywords([]);
        setStep(AppStep.KEYWORDS);
      } finally {
        setIsLoading(false);
      }
    }

    return detectedWebsite;
  };
 
  // 🔑 FUNCIÓN BASE reutilizable (UI + CSV)
  const fetchBriefByUuid = async (uuid: string): Promise<string> => {
    const cleanAuth = authToken.trim();

    if (!uuid || !cleanAuth) {
      throw new Error("UUID o token no disponible");
    }

    const authHeader = cleanAuth.startsWith("Bearer ")
      ? cleanAuth
      : `Bearer ${cleanAuth}`;

    const apiKey = "YDROlQMf.p9UwbdkpUyDiAzDd7IGK4mlKDinJkGWQ";

    const res = await fetch(
      `https://eu.api.orbidi.com/prod-line/space-management/accounts/${uuid}/brief`,
      {
        headers: {
          Accept: "application/json, text/html",
          Authorization: authHeader,
          "x-api-key": apiKey,
        },
      }
    );

    const text = await res.text();

    if (!res.ok) {
      throw new Error(`Error ${res.status}: no se pudo obtener el brief`);
    }

    return text;
  };
  
  // 🎛️ Wrapper UI (usa el UUID del input)
  const fetchBrief = async () => {
    const cleanUuid = accountUuid.trim();

    if (!cleanUuid) {
      alert("Falta el UUID del cliente");
      return;
    }

    setIsLoading(true);
    setLoadingStatus("Conectando con Orbidi...");

    try {
      const rawText = await fetchBriefByUuid(cleanUuid);

      // Detectar tipo de respuesta
      if (
        rawText.toLowerCase().includes("<!doctype html") ||
        rawText.includes("<html")
      ) {
        addLog("DETECTOR: Respuesta HTML recibida");
        await handleDataAcquisition(rawText);
      } else {
        addLog("ÉXITO: Datos JSON recibidos");
        const data = JSON.parse(rawText);
        await handleDataAcquisition(data);
      }
    } catch (e: any) {
      addLog(`FALLO: ${e.message}`);
      alert(`No se pudo obtener el brief: ${e.message}`);
    } finally {
      setIsLoading(false);
      setLoadingStatus("");
    }
  };

  const proceedToOutline = async () => {
    if (keywords.length === 0) return alert("Indica keywords.");
    setIsLoading(true);
    setLoadingStatus("Generando Estructura H2...");
    try {
      const outline = await generateArticleOutline(keywords[0], keywords, 'on-page');

      addLog("📐 Outline recibido desde Gemini:");
      addLog(JSON.stringify(outline, null, 2));

      // 🔍 VERIFICAR si Gemini devolvió secciones con títulos válidos
      const hasValidSections = outline && 
                              Array.isArray(outline.sections) && 
                              outline.sections.length > 0 &&
                              outline.sections.every(s => s.title && s.title.trim().length > 0);

      if (!hasValidSections) {
        addLog("⚠️ Gemini no devolvió secciones válidas. Generando fallback inteligente...");

        // 📝 FALLBACK INTELIGENTE: Generar títulos H2 basados en keywords
        const sectionTemplates = [
          { prefix: "¿Qué es", suffix: "?" },
          { prefix: "Beneficios de", suffix: "" },
          { prefix: "Cómo funciona", suffix: "" },
          { prefix: "Tipos de", suffix: "" },
        ];
        
        const fallbackSections = keywords.slice(0, 4).map((kw, i) => {
          const template = sectionTemplates[i] || { prefix: "Todo sobre", suffix: "" };
          return {
            id: `section-${i + 1}`,
            title: `${template.prefix} ${kw}${template.suffix}`,
            content: ''
          };
        });

        setArticle(prev => ({
          ...prev,
          title: outline?.title || `Guía completa sobre ${keywords[0]}`,
          sections: fallbackSections,
          primaryKeywords: keywords
        }));
        
        addLog(`✅ Fallback generado con ${fallbackSections.length} secciones`);
      } else {
        setArticle(prev => ({
          ...prev,
          ...outline,
          primaryKeywords: keywords
        }));
        
        addLog(`✅ Outline de Gemini: ${outline.sections?.length} secciones`);
      }

      setStep(AppStep.OUTLINE);

    } catch (e: any) {
      addLog(`Error Estructura: ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const startWriting = async (): Promise<Partial<Article>> => {
    setIsLoading(true);

    try {
      const sections = [...(article.sections || [])];

      // 1️⃣ Generar contenido de cada sección
      for (let i = 0; i < sections.length; i++) {
        setLoadingStatus(`Redactando sección ${i + 1}/${sections.length}...`);

        const rawContent = await generateSectionContent(
          sections[i],
          article.title || ""
        );

        // ✅ APLICAR MEJORA DE LEGIBILIDAD (Flesch-Kincaid > 60)
        const readableContent = improveReadability(rawContent);
        sections[i].content = readableContent;

        if (!sections[i].id) {
          sections[i].id = `section-${i + 1}`;
        }

        addLog(`H2 "${sections[i].title}" finalizado (legibilidad optimizada).`);
        await wait(200);
      }

      // 🔗 2️⃣ INSERCIÓN DE ENLACES INTERNOS (SOLO SI EL CLIENTE TIENE WEB)
      let finalSections = sections;
      
      if (clientWebsite) {
        // ✅ CLIENTE TIENE WEB: Insertar 3 enlaces obligatorios
        setLoadingStatus("Generando enlaces internos...");
        addLog("🔗 Generando 3 enlaces internos estándar del cliente...");

        const internalLinks = generateClientInternalLinks(clientWebsite);
        
        addLog(`✅ Enlaces generados:`);
        internalLinks.forEach((link, i) => {
          addLog(`  ${i + 1}. ${link}`);
        });

        setLoadingStatus("Insertando enlaces en el contenido...");
        addLog("🔗 Insertando 3 enlaces obligatorios en el artículo...");

        finalSections = insertInternalLinksIntoSections(
          sections.map(s => ({ ...s, content: s.content })),
          internalLinks
        );

        // 🔍 VERIFICACIÓN ESTRICTA
        let totalLinksInserted = 0;
        finalSections.forEach((section, idx) => {
          const linkMatches = section.content?.match(/<a\s+href=/g);
          const linksInSection = linkMatches ? linkMatches.length : 0;
          totalLinksInserted += linksInSection;
          
          if (linksInSection > 0) {
            console.log(`[Verificación] Sección ${idx}: ${linksInSection} enlaces`);
          }
        });

        addLog(`✅ Total: ${totalLinksInserted} enlaces insertados.`);
        
        // 🚨 BLOQUEO DURO SI NO HAY 3 ENLACES (solo si tiene web)
        if (totalLinksInserted < 3) {
          throw new Error(
            `⚠️ BLOQUEO CRÍTICO: Solo se insertaron ${totalLinksInserted} enlaces.\n\n` +
            `Se requieren 3 enlaces internos obligatorios cuando el cliente tiene web.\n` +
            `El artículo no puede publicarse sin ellos.\n\n` +
            `Razón: El contenido generado es demasiado corto o no tiene párrafos adecuados.\n` +
            `Solución: Regenera el artículo o ajusta el brief para generar más contenido.`
          );
        }
      } else {
        // ℹ️ CLIENTE SIN WEB: Continuar sin enlaces
        addLog("ℹ️ El cliente no tiene sitio web registrado.");
        addLog("✓ El artículo se publicará sin enlaces internos.");
      }

      // 4️⃣ GENERACIÓN DE IMAGEN (OBLIGATORIA)
      setLoadingStatus("Generando imagen editorial con IA...");
      addLog("Generando imagen editorial (obligatoria)...");

      const imagePrompt = `Create a high-quality editorial image to accompany an SEO article.

This image will be generated at the same time as the article and must visually support its content.

Image purpose
• The image must be contextually useful, not decorative.
• It should help the reader understand the main topic, concept, process, or environment described in the article.
• Think of it as a featured image for an online article.

Editorial style references
Use the visual standards commonly found in digital articles from:
• The New York Times
• National Geographic
• Wired
• El País Retina
• BBC Mundo
• The Guardian

Style characteristics:
• Clean, editorial, realistic or semi-realistic
• Clear visual focus
• Natural lighting
• Professional composition
• No exaggerated effects
• No stock-photo clichés

Technical requirements (mandatory)
Technical requirements (mandatory)
• Size: 1536 × 864 px
• Aspect ratio: 16:9
• Orientation: horizontal (wide image, landscape)
• Suitable for WordPress featured image
• No text overlays
• No watermarks
• No logos unless explicitly requested
Image format: wide editorial image, 16:9 aspect ratio.

SEO & accessibility guidance (internal)
• The image must visually match the main keyword and article topic.
• It should be easy to describe with an alt text that naturally includes the main keyword.

Article context
Main keyword: ${keywords[0]}

Article topic: ${article.title}

Generate only the image.`;

      const MAX_IMAGE_ATTEMPTS = 3;
      let imageBase64: string | null = null;
      let lastImageError: any = null;

      for (let attempt = 1; attempt <= MAX_IMAGE_ATTEMPTS; attempt++) {
        try {
          addLog(`Intento ${attempt}/${MAX_IMAGE_ATTEMPTS} de generación de imagen`);

          const rawImage = await generateImage(imagePrompt);

          if (!rawImage) {
            throw new Error("La imagen no fue generada.");
          }

          setLoadingStatus("Normalizando imagen editorial...");
          const normalizedImage = await resizeImageTo1536x864(rawImage);

          imageBase64 = normalizedImage;
          addLog("✓ Imagen válida generada (1536x864)");
          break;

        } catch (err: any) {
          lastImageError = err;
          console.warn("⚠ Error generando imagen:", err);
          addLog(`⚠ Error imagen: ${err.message}`);
          await wait(800 * attempt);
        }
      }

      if (!imageBase64) {
        throw new Error(
          `No se pudo generar una imagen válida tras ${MAX_IMAGE_ATTEMPTS} intentos. Último error: ${lastImageError?.message}`
        );
      }

      // 5️⃣ CONSTRUIR ARTÍCULO COMPLETO
      const completeArticle: Partial<Article> = {
        ...article,
        sections: finalSections,
        featuredImage: {
          prompt: imagePrompt,
          size: "1536x864",
          altText: `${article.title} - ${keywords[0]}`,
          base64: imageBase64,
        },
      };

      addLog("✓ Imagen editorial final aceptada.");
      
      if (clientWebsite) {
        addLog(`✅ Artículo completo: 3 enlaces internos + imagen 1536×864 + legibilidad optimizada`);
      } else {
        addLog(`✅ Artículo completo: imagen 1536×864 + legibilidad optimizada (sin enlaces internos)`);
      }

      // 6️⃣ ACTUALIZAR STATE (para UI)
      setArticle(completeArticle);
      setStep(AppStep.WRITING);

      // 7️⃣ RETORNAR EL ARTÍCULO COMPLETO
      return completeArticle;

    } catch (e: any) {
      console.error("❌ Error crítico en startWriting:", e);
      addLog(`❌ Error crítico: ${e.message}`);
      alert(`Proceso detenido:\n\n${e.message}`);
      throw e;
    } finally {
      setIsLoading(false);
      setLoadingStatus("");
    }
  };

  const publish = async () => {
    setIsPublishing(true);
    setPublishResult(null);
    const WP_TOKEN = `Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOjEsIm5hbWUiOiJhZG1pbl90eXYxbGE5eiIsImlhdCI6MTc2ODk0NjU4OCwiZXhwIjoxOTI2NjI2NTg4fQ.u68uZRSdvnyPBCGAygCWEp4QbfzK8lYnbaMzOcxk7S0`;
    
    try {
      let featuredMediaId: number | null = null;

      // 1. Si hay imagen generada, subirla primero
      if (article.featuredImage && typeof article.featuredImage === 'object' && article.featuredImage.base64) {
        setLoadingStatus("Subiendo imagen a la web...");
        featuredMediaId = await uploadImageToWP(
          article.featuredImage.base64, 
          article.title || "SEO Article Image", 
          WP_TOKEN
        );
      }

      // 2. Obtener el ID de la categoría "SEO On page - Blog"
      setLoadingStatus("Obteniendo categorías de WordPress...");
      addLog("Buscando categoría 'SEO On page - Blog'...");
      
      const categoriesResponse = await fetch(
        "https://masproposals.com/wp-json/wp/v2/categories?search=SEO On page - Blog&per_page=100",
        {
          headers: { 'Authorization': WP_TOKEN }
        }
      );

      let categoryId: number | undefined;

      if (categoriesResponse.ok) {
        const categories = await categoriesResponse.json();
        const targetCategory = categories.find(
          (cat: any) => cat.name === "SEO On page - Blog"
        );

        if (targetCategory) {
          categoryId = targetCategory.id;
          addLog(`✓ Categoría encontrada: ID ${categoryId}`);
        } else {
          addLog("⚠️ Categoría 'SEO On page - Blog' no encontrada. Se publicará sin categoría.");
        }
      }

      setLoadingStatus("Publicando artículo en WordPress...");
      
      // 3. Publicar el post con categoría e imagen destacada
      const response = await fetch("https://masproposals.com/wp-json/wp/v2/posts", {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': WP_TOKEN },
        body: JSON.stringify({
          title: article.title,
          content: (article.sections || []).map(s => `<h2>${s.title}</h2><div>${s.content}</div>`).join(""),
          status: 'publish',
          featured_media: featuredMediaId || undefined,
          categories: categoryId ? [categoryId] : undefined
        })
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Error publicando en WordPress");
      }

      const post = await response.json();
      setPublishResult({ 
        success: true, 
        msg: "¡Artículo publicado con imagen y categoría SEO!", 
        url: post.link 
      });
      addLog(`✓ Publicación exitosa en masproposals.com`);
      addLog(`✓ Categoría: SEO On page - Blog`);
      
      if (clientWebsite) {
        addLog(`✓ Enlaces internos: 3 incluidos`);
      } else {
        addLog(`ℹ️ Enlaces internos: 0 (cliente sin web)`);
      }
    } catch (e: any) {
      setPublishResult({ success: false, msg: e.message });
      addLog(`❌ Fallo en publicación: ${e.message}`);
    } finally {
      setIsPublishing(false);
      setLoadingStatus("");
    }
  };

  // 🔄 Versión de proceedToOutline SIN cambio de step (para CSV)
  const proceedToOutlineCSV = async (kws: string[]): Promise<any> => {
    if (kws.length === 0) throw new Error("No hay keywords");
    
    const articleNumber = batchProgress.currentArticle || 1;
    const accountUuid = batchProgress.currentAccountUuid;
    
    // 🧠 Obtener títulos previos de esta cuenta
    const previousTitles = accountUuid ? (accountMemory[accountUuid] || []) : [];
    
    addLog(`🧠 Verificando memoria: ${previousTitles.length} títulos previos en esta cuenta`);
    
    // 🎲 Agregar variación al prompt según el artículo actual
    const variationPrompts = [
      "on-page", // Artículo 1: enfoque estándar
      "comprehensive-guide", // Artículo 2: guía completa
      "quick-tips", // Artículo 3: tips rápidos
      "deep-dive", // Artículo 4+: análisis profundo
    ];
    
    const contentType = variationPrompts[Math.min(articleNumber - 1, variationPrompts.length - 1)];
    
    addLog(`🎨 Generando artículo tipo: ${contentType} (variación ${articleNumber})`);
    
    const outline = await generateArticleOutline(kws[0], kws, contentType as ContentType);

    let articleData;
    
    // 🔍 VERIFICAR si Gemini devolvió secciones con títulos válidos
    const hasValidSections = outline && 
                            Array.isArray(outline.sections) && 
                            outline.sections.length > 0 &&
                            outline.sections.every(s => s.title && s.title.trim().length > 0);
    
    if (!hasValidSections) {
      addLog("⚠️ Gemini no devolvió secciones válidas. Generando fallback inteligente...");
      
      // 📝 FALLBACK INTELIGENTE: Generar títulos H2 basados en keywords
      const sectionTemplates = [
        { prefix: "¿Qué es", suffix: "?" },
        { prefix: "Beneficios de", suffix: "" },
        { prefix: "Cómo funciona", suffix: "" },
        { prefix: "Tipos de", suffix: "" },
        { prefix: "Guía completa sobre", suffix: "" },
      ];
      
      const fallbackSections = kws.slice(0, 4).map((kw, i) => {
        const template = sectionTemplates[i] || { prefix: "Todo sobre", suffix: "" };
        return {
          id: `section-${i + 1}`,
          title: `${template.prefix} ${kw}${template.suffix}`,
          content: ''
        };
      });

      // Generar título variado según el número de artículo y asegurarse de que sea diferente
      const titleVariations = [
        `Guía completa sobre ${kws[0]}`,
        `${kws[0]}: Todo lo que necesitas saber`,
        `Descubre ${kws[0]}: Guía práctica`,
        `${kws[0]} explicado: Información esencial`,
        `Conoce todo sobre ${kws[0]}`,
        `${kws[0]}: Guía definitiva`,
      ];
      
      // 🧠 Buscar un título que no esté en la memoria
      let selectedTitle = outline?.title;
      
      if (!selectedTitle || previousTitles.includes(selectedTitle)) {
        for (const variation of titleVariations) {
          if (!previousTitles.includes(variation)) {
            selectedTitle = variation;
            break;
          }
        }
        
        // Si todos los títulos ya existen, agregar número
        if (previousTitles.includes(selectedTitle || '')) {
          selectedTitle = `${titleVariations[articleNumber - 1]} (${articleNumber})`;
        }
      }

      articleData = {
        title: selectedTitle,
        sections: fallbackSections,
        primaryKeywords: kws
      };
      
      addLog(`✅ Fallback generado: ${articleData.title}`);
      addLog(`✅ Secciones: ${fallbackSections.map(s => s.title).join(', ')}`);
    } else {
      // ✅ Gemini devolvió estructura válida
      let finalTitle = outline.title;
      
      // 🧠 Verificar si el título ya existe en la memoria
      if (previousTitles.includes(finalTitle)) {
        addLog(`⚠️ Título duplicado detectado: "${finalTitle}"`);
        
        // Agregar variación al título
        const titleSuffixes = [
          ": Guía completa",
          ": Todo lo que debes saber",
          ": Información esencial",
          ": Aspectos clave",
          " en detalle",
        ];
        
        for (const suffix of titleSuffixes) {
          const newTitle = `${finalTitle}${suffix}`;
          if (!previousTitles.includes(newTitle)) {
            finalTitle = newTitle;
            addLog(`✅ Título modificado para evitar duplicado: "${finalTitle}"`);
            break;
          }
        }
        
        // Si aún así existe, agregar número
        if (previousTitles.includes(finalTitle)) {
          finalTitle = `${outline.title} (${articleNumber})`;
          addLog(`✅ Título con número: "${finalTitle}"`);
        }
      }
      
      articleData = {
        ...outline,
        title: finalTitle,
        primaryKeywords: kws
      };
      
      addLog(`✅ Outline de Gemini: ${articleData.sections?.length} secciones`);
    }
    
    // 🧠 GUARDAR el título en la memoria
    if (accountUuid && articleData.title) {
      setAccountMemory(prev => ({
        ...prev,
        [accountUuid]: [...(prev[accountUuid] || []), articleData.title!]
      }));
      addLog(`🧠 Título guardado en memoria: "${articleData.title}"`);
    }
    
    setArticle(articleData);
    await wait(500);
    
    return articleData;
  };

  // 🧠 Procesa una fila del CSV (1 cuenta = N artículos)
  const processCsvRow = async (row: CsvRow, accountIndex: number, totalAccounts: number): Promise<string[]> => {
    const publishedUrls: string[] = [];

    try {
      // Actualizar progreso: iniciando cuenta
      setBatchProgress(prev => ({
        ...prev,
        currentAccount: accountIndex + 1,
        totalAccounts: totalAccounts,
        currentArticle: 0,
        totalArticles: row.task_count
      }));

      // 1️⃣ Obtener brief UNA SOLA VEZ por cuenta
      addLog(`📥 Obteniendo brief para cuenta ${accountIndex + 1}...`);
      const rawText = await fetchBriefByUuid(row.account_uuid);
      
      let detectedWebsite: string | null = null;
      
      if (rawText.toLowerCase().includes("<!doctype html") || rawText.includes("<html")) {
        detectedWebsite = await handleDataAcquisition(rawText, true);
      } else {
        const data = JSON.parse(rawText);
        detectedWebsite = await handleDataAcquisition(data, true);
      }
      
      // Guardar el website detectado para esta cuenta
      if (detectedWebsite) {
        setClientWebsite(detectedWebsite);
        addLog(`✅ Website para esta cuenta: ${detectedWebsite}`);
      } else {
        setClientWebsite(null);
        addLog(`ℹ️ Esta cuenta no tiene website`);
      }

      // 2️⃣ Preparar keywords (máximo 5) UNA SOLA VEZ
      let keywordsText = row.kw.trim();
      if (keywordsText.startsWith('[') && keywordsText.endsWith(']')) {
        keywordsText = keywordsText.slice(1, -1);
      }
      
      const allKeywords = keywordsText.split(",").map(k => k.trim()).filter(k => k.length > 0);
      if (allKeywords.length === 0) throw new Error("No hay keywords válidas");
      
      const keywordsToUse = allKeywords.slice(0, 5);
      setKeywords(keywordsToUse);
      addLog(`🔑 Keywords configuradas: ${keywordsToUse.join(", ")}`);
      await wait(500);

      // 3️⃣ Generar N artículos para esta cuenta
      addLog(`📊 Generando ${row.task_count} artículos para esta cuenta...`);
      
      for (let i = 0; i < row.task_count; i++) {
        addLog(`\n========================================`);
        addLog(`📝 ARTÍCULO ${i + 1}/${row.task_count}`);
        addLog(`========================================`);
        
        // Actualizar progreso
        setBatchProgress(prev => ({
          ...prev,
          currentArticle: i + 1
        }));

        // PASO 1: Generar estructura (outline)
        addLog(`🏗️ Paso 1/3: Generando estructura...`);
        await proceedToOutlineCSV(keywordsToUse);
        await wait(1000);
        
        // PASO 2: Escribir contenido completo (incluye imagen)
        addLog(`✍️ Paso 2/3: Redactando contenido completo...`);
        const completeArticle = await startWriting();
        
        // 🔍 VERIFICAR que el artículo tiene contenido
        if (!completeArticle.sections || completeArticle.sections.length === 0) {
          throw new Error("El artículo no tiene secciones después de startWriting");
        }
        
        addLog(`✅ Artículo con ${completeArticle.sections.length} secciones listo para publicar`);
        
        // PASO 3: Publicar en WordPress
        addLog(`📤 Paso 3/3: Publicando en WordPress...`);
        
        // Temporalmente actualizar el estado article para que publish() lo use
        setArticle(completeArticle);
        await wait(500);
        
        await publish();
        
        // Capturar URL
        await wait(1000);
        if (publishResult?.success && publishResult.url) {
          publishedUrls.push(publishResult.url);
          addLog(`✅ Artículo ${i + 1} publicado: ${publishResult.url}`);
          
          setBatchProgress(prev => ({
            ...prev,
            publishedUrls: [...prev.publishedUrls, publishResult.url!]
          }));
        } else {
          addLog(`⚠️ Artículo ${i + 1} no se pudo publicar`);
        }
        
        // Esperar entre artículos (excepto el último)
        if (i < row.task_count - 1) {
          addLog(`⏳ Esperando 3s antes del siguiente artículo...`);
          await wait(3000);
        }
      }

      addLog(`\n✅ Cuenta ${accountIndex + 1} completada: ${publishedUrls.length}/${row.task_count} artículos publicados`);
      return publishedUrls;

    } catch (e: any) {
      addLog(`❌ Error en cuenta ${accountIndex + 1}: ${e.message}`);
      throw e;
    }
  };

  // 🏭 Inicia la producción masiva desde CSV (modo semi-automático)
  const startBatchProduction = async () => {
    if (csvRows.length === 0) {
      alert("No hay filas CSV cargadas");
      return;
    }

    // Resetear progreso
    setBatchProgress({
      currentAccount: 0,
      totalAccounts: csvRows.length,
      currentArticle: 0,
      totalArticles: 0,
      publishedUrls: [],
      isComplete: false
    });

    // Cargar primera cuenta
    await loadNextCsvAccount();
  };

  // 📥 Cargar la siguiente cuenta del CSV
  const loadNextCsvAccount = async () => {
    const currentIndex = batchProgress.currentAccount;
    
    if (currentIndex >= csvRows.length) {
      // Todas las cuentas procesadas
      setBatchProgress(prev => ({
        ...prev,
        isComplete: true
      }));
      return;
    }

    const row = csvRows[currentIndex];
    
    setIsLoading(true);
    addLog(`\n========================================`);
    addLog(`📂 CUENTA ${currentIndex + 1}/${csvRows.length}`);
    addLog(`========================================`);

    try {
      // 1️⃣ Obtener brief
      addLog(`📥 Obteniendo brief...`);
      const rawText = await fetchBriefByUuid(row.account_uuid);
      
      let detectedWebsite: string | null = null;
      
      if (rawText.toLowerCase().includes("<!doctype html") || rawText.includes("<html")) {
        detectedWebsite = await handleDataAcquisition(rawText, true);
      } else {
        const data = JSON.parse(rawText);
        detectedWebsite = await handleDataAcquisition(data, true);
      }
      
      if (detectedWebsite) {
        setClientWebsite(detectedWebsite);
        addLog(`✅ Website detectado: ${detectedWebsite}`);
      } else {
        setClientWebsite(null);
        addLog(`ℹ️ Sin website`);
      }

      // 2️⃣ Preparar keywords
      let keywordsText = row.kw.trim();
      if (keywordsText.startsWith('[') && keywordsText.endsWith(']')) {
        keywordsText = keywordsText.slice(1, -1);
      }
      
      const allKeywords = keywordsText.split(",").map(k => k.trim()).filter(k => k.length > 0);
      if (allKeywords.length === 0) throw new Error("No hay keywords válidas");
      
      const keywordsToUse = allKeywords.slice(0, 5);
      setKeywords(keywordsToUse);
      addLog(`🔑 Keywords: ${keywordsToUse.join(", ")}`);

      // 3️⃣ Actualizar progreso
      setBatchProgress(prev => ({
        ...prev,
        currentAccount: currentIndex + 1,
        currentArticle: 0,
        totalArticles: row.task_count,
        currentAccountUuid: row.account_uuid // ← Guardar UUID actual
      }));

      // 🧠 Inicializar memoria para esta cuenta si no existe
      if (!accountMemory[row.account_uuid]) {
        setAccountMemory(prev => ({
          ...prev,
          [row.account_uuid]: []
        }));
        addLog(`🧠 Memoria inicializada para cuenta ${row.account_uuid.slice(0, 12)}...`);
      } else {
        const previousTitles = accountMemory[row.account_uuid];
        addLog(`🧠 Memoria recuperada: ${previousTitles.length} títulos previos`);
        previousTitles.forEach((title, i) => {
          addLog(`   ${i + 1}. "${title}"`);
        });
      }

      // 4️⃣ Cambiar a vista de KEYWORDS para que el usuario confirme
      setStep(AppStep.KEYWORDS);

    } catch (e: any) {
      addLog(`❌ Error: ${e.message}`);
      alert(`Error cargando cuenta ${currentIndex + 1}:\n\n${e.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // ➡️ Continuar al siguiente artículo en modo CSV
  const continueToNextArticle = () => {
    const currentArticle = batchProgress.currentArticle;
    const totalArticles = batchProgress.totalArticles;

    if (currentArticle >= totalArticles) {
      // Todos los artículos de esta cuenta procesados
      const nextAccountIndex = batchProgress.currentAccount; // Ya está en base 1
      
      if (nextAccountIndex >= batchProgress.totalAccounts) {
        // ✅ TODAS LAS CUENTAS COMPLETADAS - Mostrar resumen final
        addLog(`\n========================================`);
        addLog(`🎉 ¡PRODUCCIÓN COMPLETADA!`);
        addLog(`========================================`);
        addLog(`📊 Total de artículos publicados: ${batchProgress.publishedUrls.length}`);
        
        setBatchProgress(prev => ({
          ...prev,
          isComplete: true
        }));
        
        // Ir a la vista de ACCOUNT para mostrar el resumen
        setStep(AppStep.ACCOUNT);
      } else {
        // Ir a siguiente cuenta
        addLog(`✅ Cuenta ${batchProgress.currentAccount} completada`);
        loadNextCsvAccount();
      }
    } else {
      // Generar siguiente artículo de esta cuenta
      addLog(`\n📝 Artículo ${currentArticle + 1}/${totalArticles}`);
      
      // 🔄 ROTAR KEYWORDS para generar un artículo diferente
      // Tomar las keywords y ponerlas en diferente orden
      const rotatedKeywords = [...keywords];
      
      // Rotar según el número de artículo actual
      for (let i = 0; i < currentArticle; i++) {
        const first = rotatedKeywords.shift();
        if (first) rotatedKeywords.push(first);
      }
      
      setKeywords(rotatedKeywords);
      addLog(`🔄 Keywords rotadas para variación: ${rotatedKeywords.join(", ")}`);
      
      // Resetear publishResult para limpiar el mensaje anterior
      setPublishResult(null);
      
      setStep(AppStep.KEYWORDS);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex font-inter text-slate-900 overflow-hidden">
      {/* Consola Lateral */}
      <aside className="hidden lg:flex w-80 bg-slate-950 flex-col border-r border-slate-800 p-8 shrink-0">
        <div className="flex items-center gap-3 mb-10">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <i className="fas fa-robot text-white text-xl"></i>
          </div>
          <h1 className="text-white font-black text-xl tracking-tighter uppercase">Orbidi <span className="text-indigo-400">SEO</span></h1>
        </div>

        <div className="flex-1 flex flex-col min-h-0">
          <span className="text-[10px] uppercase font-black text-slate-500 tracking-widest mb-4 block">Monitor de Red</span>
          <div className="bg-black/50 rounded-2xl border border-slate-800 p-5 font-mono text-[9px] leading-relaxed flex-1 overflow-y-auto custom-scrollbar text-slate-400">
            {logs.map((log, i) => (
              <div key={i} className="mb-2 border-l-2 border-indigo-500/20 pl-3">
                {log}
              </div>
            ))}
            {logs.length === 0 && <div className="italic opacity-20">Inactivo...</div>}
          </div>
        </div>
      </aside>

      {/* Panel Principal */}
      <main className="flex-1 overflow-y-auto h-screen relative bg-white">
        <div className="max-w-4xl mx-auto p-12 lg:p-24">
          
          {step === AppStep.AUTH && (
            <div className="flex flex-col items-center justify-center min-h-[60vh] animate-slideUp">
              <div className="bg-white p-12 rounded-[3.5rem] shadow-2xl border border-slate-100 max-w-md w-full text-center">
                <div className="w-16 h-16 bg-indigo-50 rounded-2xl flex items-center justify-center mx-auto mb-8 text-indigo-600">
                  <i className="fas fa-fingerprint text-2xl"></i>
                </div>
                <h2 className="text-2xl font-black mb-2">Acceso a Datos</h2>
                <p className="text-slate-400 text-sm mb-10">Introduce tu Bearer Token de Orbidi</p>
                <div className="space-y-6">
                  <input 
                    type="password" 
                    className="w-full px-6 py-4 rounded-2xl bg-slate-50 border-2 border-transparent focus:border-indigo-600 outline-none font-bold"
                    placeholder="Bearer eyJhbGci..."
                    value={authToken}
                    onChange={e => setAuthToken(e.target.value)}
                  />
                  <button 
                    onClick={() => setStep(AppStep.ACCOUNT)}
                    className="w-full bg-slate-900 text-white font-black py-5 rounded-2xl shadow-xl hover:bg-black transition-all text-xs uppercase tracking-widest"
                  >
                    Establecer Conexión
                  </button>
                </div>
              </div>
            </div>
          )}

          {step === AppStep.ACCOUNT && (
            <div className="animate-slideUp max-w-2xl mx-auto">
              {/* Vista de resumen final cuando se completa todo */}
              {batchProgress.isComplete ? (
                <div className="space-y-8">
                  <div className="text-center">
                    <div className="inline-block p-8 bg-green-100 rounded-full mb-6">
                      <i className="fas fa-trophy text-6xl text-green-600"></i>
                    </div>
                    <h2 className="text-5xl font-black text-green-900 mb-4">
                      ¡Producción Masiva Completada!
                    </h2>
                    <p className="text-green-600 text-xl">
                      {batchProgress.publishedUrls.length} artículos publicados exitosamente
                    </p>
                  </div>

                  <div className="bg-white p-10 rounded-[4rem] shadow-2xl border border-slate-100">
                    <h3 className="font-black text-slate-900 text-2xl mb-6 flex items-center gap-3">
                      <i className="fas fa-link text-indigo-600"></i>
                      Enlaces Publicados
                    </h3>
                    
                    <div className="space-y-4">
                      {batchProgress.publishedUrls.map((url, idx) => (
                        <div key={idx} className="flex items-center gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-200 hover:border-indigo-300 transition-all group">
                          <div className="flex-shrink-0 w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center">
                            <span className="text-indigo-600 font-black text-lg">{idx + 1}</span>
                          </div>
                          <a 
                            href={url} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="flex-1 text-indigo-600 hover:text-indigo-800 text-base font-semibold truncate group-hover:underline"
                          >
                            {url}
                          </a>
                          <button 
                            onClick={() => {
                              navigator.clipboard.writeText(url);
                              addLog(`📋 URL copiada: ${url.slice(0, 50)}...`);
                            }}
                            className="flex-shrink-0 text-slate-400 hover:text-indigo-600 transition-colors"
                            title="Copiar URL"
                          >
                            <i className="fas fa-copy text-xl"></i>
                          </button>
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex-shrink-0 text-slate-400 hover:text-green-600 transition-colors"
                            title="Abrir en nueva pestaña"
                          >
                            <i className="fas fa-external-link-alt text-xl"></i>
                          </a>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex gap-4">
                    <button 
                      onClick={updateClickUpTasks}
                      disabled={isLoading}
                      className="flex-1 bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-black py-6 rounded-3xl hover:from-purple-700 hover:to-indigo-700 transition-all text-xl flex items-center justify-center gap-4 shadow-2xl"
                    >
                      {isLoading ? (
                        <>
                          <i className="fas fa-spinner fa-spin"></i>
                          Actualizando ClickUp...
                        </>
                      ) : (
                        <>
                          <i className="fas fa-check-double"></i>
                          Actualizar Tareas en ClickUp
                        </>
                      )}
                    </button>
                  </div>

                  <button 
                    onClick={() => {
                      setBatchProgress({
                        currentAccount: 0,
                        totalAccounts: 0,
                        currentArticle: 0,
                        totalArticles: 0,
                        publishedUrls: [],
                        isComplete: false
                      });
                      setCsvRows([]);
                      setIsManualMode(false);
                    }}
                    className="w-full bg-slate-900 text-white font-black py-6 rounded-3xl hover:bg-black transition-all text-xl flex items-center justify-center gap-4"
                  >
                    <i className="fas fa-plus-circle"></i>
                    Nueva Producción
                  </button>
                </div>
              ) : (
                /* Vista normal de selección de modo */
                <>
              <div className="text-center mb-10">
                <h2 className="text-4xl font-black tracking-tighter mb-3">Producción de Contenido SEO</h2>
                <p className="text-slate-500 font-medium italic">"De brief a artículo publicado en minutos"</p>
              </div>

              <div className="bg-white p-10 rounded-[4rem] shadow-2xl border border-slate-100 mb-8">
                {/* Tabs: EXTRACCIÓN AUTO vs CARGA MASIVA */}
                <div className="flex bg-slate-100 p-1.5 rounded-2xl mb-10">
                  <button 
                    onClick={() => setIsManualMode(false)} 
                    className={`flex-1 py-3 rounded-xl font-black text-[10px] transition-all ${!isManualMode ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500'}`}
                  >
                    EXTRACCIÓN AUTO
                  </button>
                  <button 
                    onClick={() => setIsManualMode(true)} 
                    className={`flex-1 py-3 rounded-xl font-black text-[10px] transition-all ${isManualMode ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500'}`}
                  >
                    CARGA MASIVA CSV
                  </button>
                </div>

                {/* MODO 1: EXTRACCIÓN AUTO (Manual - Un artículo) */}
                {!isManualMode ? (
                  <div className="space-y-8">
                    <div>
                      <label className="text-[10px] font-black uppercase text-indigo-500 mb-4 block tracking-widest">
                        UUID del Cliente (Account UUID)
                      </label>
                      <input 
                        type="text" 
                        className="w-full px-8 py-5 rounded-2xl bg-slate-50 border-2 border-transparent focus:border-indigo-600 outline-none font-black text-2xl text-center"
                        placeholder="34ad9915-6fdc-4aed-81a9..."
                        value={accountUuid}
                        onChange={e => setAccountUuid(e.target.value)}
                      />
                    </div>
                    <button 
                      onClick={fetchBrief}
                      disabled={isLoading}
                      className="w-full bg-indigo-600 text-white font-black py-6 rounded-3xl shadow-xl hover:bg-indigo-700 transition-all flex items-center justify-center gap-4 text-lg"
                    >
                      {isLoading ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-magic"></i>}
                      {isLoading ? 'Procesando...' : 'Generar 1 Artículo'}
                    </button>
                    <div className="text-[10px] text-slate-400 text-center font-medium leading-relaxed bg-slate-50 p-4 rounded-xl">
                      <i className="fas fa-info-circle mr-1"></i> 
                      Genera un artículo SEO completo con imagen, 3 enlaces internos y categorización automática.
                    </div>
                  </div>
                ) : (
                  /* MODO 2: CARGA MASIVA CSV (Producción en lote) */
                  <div className="space-y-8">
                    {/* Vista de carga del CSV */}
                    {!isLoading && !batchProgress.isComplete && (
                      <>
                        <div>
                          <label className="text-[10px] font-black uppercase text-indigo-500 mb-4 block tracking-widest">
                            Archivo CSV de Producción
                          </label>
                          <div className="border-2 border-dashed border-slate-200 rounded-3xl p-8 text-center hover:border-indigo-400 transition-all bg-slate-50">
                            <i className="fas fa-file-csv text-5xl text-slate-300 mb-4"></i>
                            <input
                              type="file"
                              accept=".csv"
                              onChange={handleCsvUpload}
                              className="hidden"
                              id="csv-upload"
                            />
                            <label 
                              htmlFor="csv-upload" 
                              className="cursor-pointer block"
                            >
                              <span className="text-indigo-600 font-black text-lg block mb-2">
                                {csvRows.length > 0 ? `✓ ${csvRows.length} filas cargadas` : 'Haz clic para cargar CSV'}
                              </span>
                              <span className="text-slate-400 text-[11px] block">
                                Columnas requeridas: account_uuid, kw, task_count
                              </span>
                            </label>
                          </div>
                        </div>

                        {csvRows.length > 0 && (
                          <div className="bg-indigo-50 border-2 border-indigo-100 rounded-2xl p-6">
                            <div className="flex items-center justify-between mb-4">
                              <div>
                                <p className="font-black text-indigo-900 text-lg">
                                  📊 {csvRows.length} cuentas detectadas
                                </p>
                                <p className="text-indigo-600 text-sm">
                                  Total de artículos: {csvRows.reduce((sum, row) => sum + row.task_count, 0)}
                                </p>
                              </div>
                              <button 
                                onClick={() => { setCsvRows([]); setCurrentRowIndex(0); }}
                                className="text-indigo-400 hover:text-indigo-600"
                              >
                                <i className="fas fa-times-circle text-2xl"></i>
                              </button>
                            </div>
                            <div className="text-[10px] text-indigo-700 bg-white rounded-xl p-4 max-h-32 overflow-y-auto">
                              {csvRows.slice(0, 5).map((row, i) => (
                                <div key={i} className="mb-2 border-b border-indigo-100 pb-2 last:border-0">
                                  <span className="font-black">Cuenta {i + 1}:</span> {row.account_uuid.slice(0, 20)}... 
                                  <span className="ml-2 text-indigo-500">→ {row.task_count} artículos</span>
                                </div>
                              ))}
                              {csvRows.length > 5 && (
                                <div className="text-indigo-400 italic mt-2">
                                  + {csvRows.length - 5} cuentas más...
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        <button 
                          onClick={startBatchProduction}
                          disabled={csvRows.length === 0}
                          className={`w-full font-black py-6 rounded-3xl shadow-xl transition-all text-lg flex items-center justify-center gap-4 ${
                            csvRows.length > 0
                              ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                              : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                          }`}
                        >
                          <i className="fas fa-industry"></i>
                          Iniciar Producción Masiva
                        </button>
                      </>
                    )}

                    {/* Vista de progreso durante la producción */}
                    {isLoading && !batchProgress.isComplete && (
                      <div className="space-y-6">
                        <div className="text-center">
                          <div className="inline-block p-6 bg-indigo-100 rounded-full mb-4">
                            <i className="fas fa-cog fa-spin text-4xl text-indigo-600"></i>
                          </div>
                          <h3 className="text-2xl font-black text-indigo-900 mb-2">
                            Producción en curso...
                          </h3>
                          <p className="text-indigo-600 text-sm">
                            Cuenta {batchProgress.currentAccount}/{batchProgress.totalAccounts} • 
                            Artículo {batchProgress.currentArticle}/{batchProgress.totalArticles}
                          </p>
                        </div>

                        <div className="bg-slate-50 rounded-2xl p-6">
                          <div className="space-y-3">
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-slate-600">Generando estructura...</span>
                              <i className="fas fa-check-circle text-green-500"></i>
                            </div>
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-slate-600">Redactando contenido...</span>
                              <i className="fas fa-spinner fa-spin text-indigo-500"></i>
                            </div>
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-slate-600">Generando imagen...</span>
                              <i className="fas fa-circle text-slate-300"></i>
                            </div>
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-slate-600">Publicando...</span>
                              <i className="fas fa-circle text-slate-300"></i>
                            </div>
                          </div>
                        </div>

                        <p className="text-center text-slate-400 text-xs">
                          Por favor espera, esto puede tomar varios minutos...
                        </p>
                      </div>
                    )}

                    {/* Vista de resultados completados */}
                    {batchProgress.isComplete && (
                      <div className="space-y-6">
                        <div className="text-center">
                          <div className="inline-block p-6 bg-green-100 rounded-full mb-4">
                            <i className="fas fa-check-circle text-4xl text-green-600"></i>
                          </div>
                          <h3 className="text-2xl font-black text-green-900 mb-2">
                            ¡Producción completada!
                          </h3>
                          <p className="text-green-600 text-sm">
                            {batchProgress.publishedUrls.length} artículos publicados exitosamente
                          </p>
                        </div>

                        <div className="bg-slate-50 rounded-2xl p-6 space-y-3">
                          <h4 className="font-black text-slate-700 text-sm mb-4">📋 Enlaces publicados:</h4>
                          {batchProgress.publishedUrls.map((url, idx) => (
                            <div key={idx} className="flex items-center gap-3 p-3 bg-white rounded-xl border border-slate-200">
                              <div className="flex-shrink-0 w-8 h-8 bg-indigo-100 rounded-full flex items-center justify-center">
                                <span className="text-indigo-600 font-black text-sm">{idx + 1}</span>
                              </div>
                              <a 
                                href={url} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="flex-1 text-indigo-600 hover:text-indigo-800 text-sm font-medium truncate"
                              >
                                {url}
                              </a>
                              <button 
                                onClick={() => {navigator.clipboard.writeText(url)}}
                                className="flex-shrink-0 text-slate-400 hover:text-slate-600"
                              >
                                <i className="fas fa-copy"></i>
                              </button>
                            </div>
                          ))}
                        </div>

                        <button 
                          onClick={() => {
                            setBatchProgress({
                              currentAccount: 0,
                              totalAccounts: 0,
                              currentArticle: 0,
                              totalArticles: 0,
                              publishedUrls: [],
                              isComplete: false
                            });
                            setCsvRows([]);
                          }}
                          className="w-full bg-slate-600 text-white font-black py-4 rounded-2xl hover:bg-slate-700 transition-all"
                        >
                          Nueva Producción
                        </button>
                      </div>
                    )}

                    {!isLoading && !batchProgress.isComplete && csvRows.length === 0 && (
                      <div className="text-[10px] text-slate-400 text-center font-medium leading-relaxed bg-slate-50 p-4 rounded-xl">
                        <i className="fas fa-lightbulb mr-1"></i> 
                        Cada fila del CSV genera automáticamente el número de artículos especificado en task_count.
                      </div>
                    )}
                  </div>
                )}
              </div>
              </>
              )}
            </div>
          )}

          {step === AppStep.KEYWORDS && (
            <div className="animate-slideUp">
              <div className="text-center mb-12">
                <h2 className="text-4xl font-black text-slate-900 mb-2 tracking-tighter">Palabras Clave SEO</h2>
                <p className="text-slate-500">Define los términos que posicionarán este artículo</p>
              </div>

              <div className="bg-white p-12 rounded-[4rem] shadow-2xl border border-slate-100 mb-10">
                <div className="flex flex-wrap gap-4 mb-12 min-h-[100px] content-start">
                  {keywords.map((kw, i) => (
                    <div key={i} className="bg-indigo-50 px-6 py-4 rounded-2xl flex items-center gap-4 border border-indigo-100 hover:border-indigo-500 transition-all group">
                      <span className="font-black text-indigo-700 text-lg">#{kw}</span>
                      <button onClick={() => setKeywords(keywords.filter((_, idx) => idx !== i))} className="text-indigo-300 group-hover:text-rose-500 transition-colors">
                        <i className="fas fa-times-circle text-xl"></i>
                      </button>
                    </div>
                  ))}
                  {keywords.length === 0 && <p className="text-slate-300 italic py-4">No hay palabras clave definidas...</p>}
                </div>
                
                <div className="flex gap-4">
                  <div className="relative flex-1">
                    <i className="fas fa-search absolute left-6 top-1/2 -translate-y-1/2 text-slate-400"></i>
                    <input 
                      type="text" 
                      className="w-full px-14 py-5 rounded-2xl bg-slate-50 border-2 border-transparent focus:border-indigo-600 outline-none font-bold text-lg"
                      placeholder="Añadir keyword personalizada..."
                      value={newKeyword}
                      onChange={e => setNewKeyword(e.target.value)}
                      onKeyPress={e => {
                        if (e.key === 'Enter' && newKeyword.trim()) {
                          setKeywords([...keywords, newKeyword.trim()]);
                          setNewKeyword('');
                        }
                      }}
                    />
                  </div>
                  <button 
                    onClick={() => { if(newKeyword.trim()) { setKeywords([...keywords, newKeyword.trim()]); setNewKeyword(''); } }} 
                    className="bg-slate-900 text-white px-10 py-5 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-indigo-600 transition-all shadow-lg"
                  >
                    Añadir
                  </button>
                </div>
              </div>
              
              <button 
                onClick={async () => {
                  if (batchProgress.totalAccounts > 0) {
                    // Modo CSV: usar proceedToOutlineCSV
                    setIsLoading(true);
                    try {
                      await proceedToOutlineCSV(keywords);
                      setStep(AppStep.OUTLINE);
                    } catch (e: any) {
                      addLog(`Error: ${e.message}`);
                    } finally {
                      setIsLoading(false);
                    }
                  } else {
                    // Modo normal
                    proceedToOutline();
                  }
                }}
                disabled={keywords.length === 0}
                className={`w-full font-black py-8 rounded-[3rem] shadow-2xl transition-all text-2xl tracking-tight flex items-center justify-center gap-4 ${keywords.length > 0 ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}
              >
                <i className="fas fa-layer-group"></i>
                Generar Estructura H2
              </button>
            </div>
          )}

          {step === AppStep.OUTLINE && (
            <div className="animate-slideUp">
              <h2 className="text-3xl font-black text-slate-900 mb-10">Arquitectura de Contenidos</h2>
              <div className="bg-white p-14 rounded-[4.5rem] shadow-2xl border border-slate-100 mb-10 space-y-12">
                <div>
                  <label className="text-[10px] font-black text-indigo-500 uppercase tracking-widest block mb-4">H1 - Título Maestro</label>
                  <input 
                    className="w-full text-4xl font-black text-slate-900 outline-none border-b-2 border-slate-50 focus:border-indigo-200 py-4 transition-all" 
                    value={article.title || ''} 
                    onChange={e => setArticle({...article, title: e.target.value})} 
                  />
                </div>
                <div className="space-y-6">
                  <label className="text-[10px] font-black text-indigo-500 uppercase tracking-widest block mb-4">H2 - Estructura de Secciones</label>
                  {(article.sections || []).map((s, i) => (
                    <div key={i} className="flex items-center gap-8 p-8 bg-slate-50 rounded-[2.5rem] border border-slate-100 group hover:bg-white hover:shadow-xl transition-all">
                      <div className="w-14 h-14 bg-indigo-600 text-white rounded-2xl flex items-center justify-center font-black text-2xl shadow-xl">{i+1}</div>
                      <input 
                        className="flex-1 bg-transparent font-black text-2xl text-slate-700 outline-none" 
                        value={s.title || ''} 
                        onChange={e => { 
                          const newSec = [...article.sections!]; 
                          newSec[i].title = e.target.value; 
                          setArticle({...article, sections: newSec}); 
                        }} 
                      />
                    </div>
                  ))}
                </div>
              </div>
              <button onClick={startWriting} className="w-full bg-indigo-600 text-white font-black py-8 rounded-[3rem] shadow-2xl hover:bg-indigo-700 transition-all text-2xl uppercase tracking-widest">Redactar Post Completo</button>
            </div>
          )}

          {step === AppStep.WRITING && (
            <div className="animate-fadeIn pb-40">
              <div className="flex flex-col md:flex-row items-center justify-between mb-16 gap-8">
                <div>
                  <h1 className="text-5xl font-black tracking-tighter text-slate-900">Resultado Final</h1>
                  <p className="text-slate-400 font-bold uppercase text-[11px] tracking-widest mt-2">
                    {batchProgress.totalAccounts > 0 
                      ? `Artículo ${batchProgress.currentArticle}/${batchProgress.totalArticles} • Cuenta ${batchProgress.currentAccount}/${batchProgress.totalAccounts}`
                      : 'Borrador optimizado y listo para WordPress'
                    }
                  </p>
                </div>
                <div className="flex gap-4 w-full md:w-auto">
                  {batchProgress.totalAccounts === 0 && (
                    <button onClick={() => setStep(AppStep.ACCOUNT)} className="flex-1 md:flex-none px-10 py-5 rounded-[2rem] border-2 border-slate-200 font-black text-[11px] hover:bg-slate-50 transition-all uppercase">NUEVO</button>
                  )}
                  <button 
                    onClick={async () => {
                      await publish();
                      
                      // Si estamos en modo CSV, actualizar progreso del artículo
                      if (batchProgress.totalAccounts > 0) {
                        await wait(500);
                        
                        const newArticleCount = batchProgress.currentArticle + 1;
                        
                        setBatchProgress(prev => ({
                          ...prev,
                          currentArticle: newArticleCount
                        }));
                      }
                    }}
                    disabled={isPublishing} 
                    className="flex-1 md:flex-none bg-indigo-600 text-white px-10 py-5 rounded-[2rem] font-black text-[11px] shadow-2xl hover:bg-indigo-700 transition-all flex items-center justify-center gap-3 uppercase"
                  >
                    {isPublishing ? <i className="fas fa-spinner fa-spin"></i> : <i className="fab fa-wordpress text-lg"></i>}
                    Publicar con Imagen
                  </button>
                </div>
              </div>

              {publishResult && (
                <div className={`mb-16 p-12 rounded-[4rem] border-4 flex flex-col gap-6 shadow-2xl animate-slideUp ${publishResult.success ? 'bg-emerald-50 border-emerald-100' : 'bg-rose-50 border-rose-100'}`}>
                  <div className="flex items-center gap-10">
                    <div className={`w-20 h-20 rounded-full flex items-center justify-center ${publishResult.success ? 'bg-emerald-500' : 'bg-rose-500'} text-white text-4xl shadow-2xl shrink-0`}>
                      <i className={`fas ${publishResult.success ? 'fa-check' : 'fa-times'}`}></i>
                    </div>
                    <div className="flex-1">
                      <p className="font-black text-3xl text-slate-900">{publishResult.msg}</p>
                      {publishResult.url && (
                        <a href={publishResult.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-indigo-600 font-black underline underline-offset-8 text-lg mt-4 group">
                          Ver Artículo Publicado
                          <i className="fas fa-external-link-alt text-sm group-hover:translate-x-1 transition-transform"></i>
                        </a>
                      )}
                    </div>
                  </div>
                  
                  {/* Botón para continuar en modo CSV */}
                  {publishResult.success && batchProgress.totalAccounts > 0 && (
                    <button 
                      onClick={continueToNextArticle}
                      className="w-full bg-slate-900 text-white font-black py-6 rounded-3xl hover:bg-black transition-all text-lg flex items-center justify-center gap-3"
                    >
                      {batchProgress.currentArticle < batchProgress.totalArticles ? (
                        <>
                          <i className="fas fa-arrow-right"></i>
                          Continuar con Artículo {batchProgress.currentArticle + 1}/{batchProgress.totalArticles}
                        </>
                      ) : (
                        batchProgress.currentAccount < batchProgress.totalAccounts ? (
                          <>
                            <i className="fas fa-arrow-right"></i>
                            Continuar con Cuenta {batchProgress.currentAccount + 1}/{batchProgress.totalAccounts}
                          </>
                        ) : (
                          <>
                            <i className="fas fa-check-double"></i>
                            Ver Resumen Final
                          </>
                        )
                      )}
                    </button>
                  )}
                </div>
              )}

              <article className="bg-white rounded-[5rem] shadow-2xl border border-slate-100 overflow-hidden">
                {article.featuredImage && typeof article.featuredImage === 'object' && article.featuredImage.base64 ? (
                  <div className="h-[600px] relative">
                    <img src={article.featuredImage.base64} className="w-full h-full object-cover" alt="Hero" />
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent"></div>
                    <div className="absolute bottom-20 left-20 right-20 text-white">
                      <h2 className="text-6xl font-black leading-tight drop-shadow-2xl">{article.title}</h2>
                    </div>
                  </div>
                ) : (
                  <div className="bg-slate-900 p-20 text-white">
                    <h2 className="text-6xl font-black leading-tight">{article.title}</h2>
                  </div>
                )}
                
                <div className="p-20 lg:p-32 max-w-4xl mx-auto space-y-24">
                  {(article.sections || []).map((section, idx) => (
                    <section key={idx}>
                      <h2 className="text-4xl font-black text-slate-900 mb-10 tracking-tight">{section.title}</h2>
                      <div className="text-2xl leading-[1.8] text-slate-600 whitespace-pre-wrap content-style" dangerouslySetInnerHTML={{ __html: section.content }} />
                    </section>
                  ))}
                </div>
              </article>
            </div>
          )}

          {/* Master AI Overlay */}
          {(isLoading || isPublishing) && (
            <div className="fixed inset-0 bg-white/95 backdrop-blur-2xl z-[100] flex flex-col items-center justify-center animate-fadeIn">
              <div className="relative mb-14">
                <div className="w-32 h-32 border-[10px] border-slate-100 rounded-full"></div>
                <div className="w-32 h-32 border-[10px] border-indigo-600 border-t-transparent rounded-full animate-spin absolute inset-0"></div>
                <div className="absolute inset-0 flex items-center justify-center text-indigo-600">
                  <i className={`fas ${isPublishing ? 'fa-cloud-upload-alt' : 'fa-brain'} text-4xl animate-pulse`}></i>
                </div>
              </div>
              <h2 className="text-3xl font-black text-slate-900 mb-2 tracking-tight text-center">
                {isPublishing ? "Conectando con WordPress" : "IA Procesando Contenido"}
              </h2>
              <p className="text-indigo-600 font-black uppercase tracking-[0.4em] text-[10px] animate-pulse">{loadingStatus}</p>
            </div>
          )}

        </div>
      </main>

      <style>{`
        @keyframes slideUp { from { opacity: 0; transform: translateY(50px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        .animate-slideUp { animation: slideUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        .animate-fadeIn { animation: fadeIn 0.5s ease-out forwards; }
        .custom-scrollbar::-webkit-scrollbar { width: 5px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 10px; }
        .content-style strong { font-weight: 900; color: #0f172a; background: rgba(99,102,241,0.08); padding: 0 4px; border-radius: 4px; }
      `}</style>
    </div>
  );
};

export default App;