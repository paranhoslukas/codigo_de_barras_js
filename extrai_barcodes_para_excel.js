import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import exceljs from 'exceljs';
import fse from 'fs-extra';
import { exec } from 'child_process'; // Módulo nativo para rodar comandos

// --- CONFIGURAÇÕES ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_PASTA = path.join(__dirname, 'pdfs');
const SAIDA_EXCEL = 'barcodes_exec.xlsx';
const TEMP_DIR = path.join(__dirname, 'temp_images');
// --------------------

/**
 * Promisifica a execução de um comando de linha.
 * @param {string} command 
 * @returns {Promise<string>} stdout do comando
 */
function runCommand(command) {
    return new Promise((resolve, reject) => {
        // Aumenta o buffer máximo para acomodar grandes saídas, se necessário
        exec(command, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
            if (error) {
                // Inclui stderr no erro para debug
                reject(new Error(`Comando falhou: ${command}\nStderr: ${stderr}\nError: ${error.message}`));
                return;
            }
            resolve(stdout);
        });
    });
}

/**
 * Processa um PDF: extrai páginas como imagens (Poppler) e lê barcodes (ZBar).
 * Assume que 'pdftoppm' e 'zbarimg' estão no PATH do sistema.
 * @param {string} caminhoPdf 
 */
async function processarPdf(caminhoPdf) {
    const nomePdf = path.basename(caminhoPdf);
    const resultados = [];
    let paginaAtual = 0;
    
    // 1. Limpa e cria pasta temporária
    await fse.ensureDir(TEMP_DIR); // Garante que o diretório exista
    await fse.emptyDir(TEMP_DIR); // Limpa o conteúdo

    try {
        // Comando Poppler: Converte o PDF em arquivos JPEG na pasta temporária
        // -r 300: 300 DPI
        // -jpeg: Usa o formato JPEG
        const ppm_saida_base = path.join(TEMP_DIR, 'page');
        
        console.log(`[Poppler] Extraindo imagens de ${nomePdf}...`);
        
        // CORREÇÃO APLICADA: Comando ajustado para robustez na execução nativa
        const poppler_command = `pdftoppm -r 300 -jpeg "${caminhoPdf}" "${ppm_saida_base}"`;
        console.log(`[DEBUG] Comando executado: ${poppler_command}`); 
        
        await runCommand(poppler_command);

        // 2. Processa cada imagem gerada
        
        const imagens = await fse.readdir(TEMP_DIR);
        
        // CORREÇÃO APLICADA: Busca mais ampla por imagens JPEG/JPG
        // Procura por page-X.jpeg ou page-X.jpg (case-insensitive)
        const paginas = imagens.filter(f => f.match(/^page-\d+\.(jpeg|jpg)$/i)).sort(); 

        if (paginas.length === 0) {
            console.log("AVISO: Poppler não gerou imagens na pasta temporária. Verifique se o Poppler está no PATH e se o PDF não está protegido.");
        }

        for (const imagemNome of paginas) {
            paginaAtual++;
            const caminhoImagem = path.join(TEMP_DIR, imagemNome);
            
            // Comando ZBar: Lê o código de barras da imagem
            console.log(`[ZBar] Lendo página ${paginaAtual} (${imagemNome})...`);
            
            // Usamos zbarimg --raw para obter o dado limpo no formato [tipo]:[dado]
            const zbarOutput = await runCommand(`zbarimg --raw -q "${caminhoImagem}"`);
            
            const dadosBarcode = zbarOutput.trim().split('\n').filter(line => line.length > 0);

            if (dadosBarcode.length === 0) {
                resultados.push({
                    arquivo_pdf: nomePdf,
                    caminho: caminhoPdf,
                    pagina: paginaAtual,
                    tipo_barcode: null,
                    dado: null
                });
            } else {
                for (const linha of dadosBarcode) {
                    const partes = linha.split(':');
                    resultados.push({
                        arquivo_pdf: nomePdf,
                        caminho: caminhoPdf,
                        pagina: paginaAtual,
                        tipo_barcode: partes[0].trim(),
                        dado: partes.slice(1).join(':').trim() // Rejunta o dado caso contenha ':'
                    });
                }
            }
        }

    } catch (e) {
        console.error(`[ERRO GERAL] Falha ao processar ${nomePdf}:`, e.message);
        resultados.push({
            arquivo_pdf: nomePdf,
            caminho: caminhoPdf,
            pagina: 'ERRO',
            tipo_barcode: 'ERRO NATIVO',
            dado: e.message
        });
    } finally {
        // 3. Limpeza
        // A remoção da pasta temporária foi feita no main, mas podemos refazê-la aqui para segurança
        // await fse.remove(TEMP_DIR); // Não limparemos aqui para facilitar o debug, se falhar novamente
    }

    return resultados;
}

// Funções listarPdfs e main (usando runCommand e processarPdf)
// ... (listarPdfs é o mesmo) ...
async function listarPdfs(pasta) {
    const arquivos = await fse.readdir(pasta, { recursive: true });
    
    const pdfArquivos = arquivos
        .filter(nome => nome.toLowerCase().endsWith('.pdf'))
        .map(nome => path.join(pasta, nome));
        
    return pdfArquivos;
}

async function main() {
    console.log("WORKING DIRECTORY:", __dirname);
    
    // Assegura que a pasta de PDFs existe
    if (!fs.existsSync(DEFAULT_PASTA)) {
        console.log(`[INFO] Pasta 'pdfs' não encontrada. Criando: ${DEFAULT_PASTA}`);
        fs.mkdirSync(DEFAULT_PASTA);
        console.log("Coloque seus PDFs na pasta 'pdfs' e rode novamente.");
        return;
    }
    
    const arquivos = await listarPdfs(DEFAULT_PASTA);
    
    if (arquivos.length === 0) {
        console.log("[INFO] Nenhum PDF encontrado na pasta (busca recursiva).");
        return;
    }

    console.log(`[INFO] Encontrados ${arquivos.length} PDF(s).`);

    let todasLinhas = [];
    for (let i = 0; i < arquivos.length; i++) {
        const arquivo = arquivos[i];
        console.log(`\n--- [${i + 1}/${arquivos.length}] Processando: ${path.basename(arquivo)} ---`);
        const res = await processarPdf(arquivo);
        todasLinhas = todasLinhas.concat(res);
    }
    
    // --- Exportar para Excel ---
    const workbook = new exceljs.Workbook();
    const sheet = workbook.addWorksheet('Barcodes');

    sheet.columns = [
        { header: 'Arquivo PDF', key: 'arquivo_pdf', width: 30 },
        { header: 'Caminho Completo', key: 'caminho', width: 60 },
        { header: 'Página', key: 'pagina', width: 10 },
        { header: 'Tipo Barcode', key: 'tipo_barcode', width: 20 },
        { header: 'Dado Extraído', key: 'dado', width: 50 }
    ];

    sheet.addRows(todasLinhas);
    
    await workbook.xlsx.writeFile(SAIDA_EXCEL);
    console.log(`\n[CONCLUÍDO] Resultados salvos em: ${path.resolve(SAIDA_EXCEL)} (linhas: ${todasLinhas.length})`);

    // Limpeza final da pasta temporária
    await fse.remove(TEMP_DIR);
}

main().catch(err => {
    console.error("\n--- ERRO CRÍTICO NA EXECUÇÃO GERAL (MAIN) ---\n", err);
});