import express from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import exceljs from 'exceljs';
import { exec } from 'child_process';
import fse from 'fs-extra';

// --- SETUP DO SERVIDOR E CAMINHOS ---
const app = express();
const port = 3000;

app.use(express.static('public'));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Pastas de trabalho
const UPLOAD_DIR = path.join(__dirname, 'uploads'); // Onde os PDFs serão enviados
const TEMP_DIR = path.join(__dirname, 'temp_images');// Onde as imagens temporárias serão salvas
const OUTPUT_DIR = path.join(__dirname, 'output');// Onde o arquivo Excel final será salvo

// Configuração do Multer para preservar o nome original
const storage = multer.diskStorage({
    destination: UPLOAD_DIR, // Onde o arquivo será salvo temporariamente
    filename: (req, file, cb) => {
        // CORREÇÃO: Usa o nome original do arquivo para manter a rastreabilidade
        cb(null, file.originalname);
    }
});

const upload = multer({ storage: storage });

// Garante que os diretórios existam
fse.ensureDirSync(UPLOAD_DIR);
fse.ensureDirSync(TEMP_DIR);
fse.ensureDirSync(OUTPUT_DIR);

// --- LÓGICA DE ORQUESTRAÇÃO NATIVA ---

/**
 * Promisifica a execução de um comando de linha.
 * @param {string} command 
 * @returns {Promise<string>} stdout do comando
 */
function runCommand(command) {
    return new Promise((resolve, reject) => {
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
 * Processa um único PDF usando Poppler (imagem) e ZBar (leitura).
 * @param {string} caminhoPdf 
 */

async function processarPdf(caminhoPdf) {
    const nomePdf = path.basename(caminhoPdf);
    const resultados = [];
    let paginaAtual = 0;
    
    // Limpa a pasta de imagens para o novo processamento
    await fse.emptyDir(TEMP_DIR);

    try {
        const ppm_saida_base = path.join(TEMP_DIR, 'page');
        
        // 1. POOPPLER: Extrai imagens
        console.log(`[Poppler] Extraindo imagens de ${nomePdf}...`);
        
        const poppler_command = `pdftoppm -r 300 -jpeg "${caminhoPdf}" "${ppm_saida_base}"`;
        await runCommand(poppler_command); // Executa a conversão

        // 2. Processa cada imagem gerada
        const imagens = await fse.readdir(TEMP_DIR);
        // Busca por page-X.jpeg ou page-X.jpg (case-insensitive)
        const paginas = imagens.filter(f => f.match(/^page-\d+\.(jpeg|jpg)$/i)).sort(); 

        for (const imagemNome of paginas) {
            paginaAtual++;
            const caminhoImagem = path.join(TEMP_DIR, imagemNome);
            
            // 3. ZBAR: Lê o código de barras da imagem
            console.log(`[ZBar] Lendo página ${paginaAtual} (${imagemNome})...`);
            
            const zbarOutput = await runCommand(`zbarimg --raw -q "${caminhoImagem}"`);
            
            const dadosBarcode = zbarOutput.trim().split('\n').filter(line => line.length > 0);

            if (dadosBarcode.length > 0) {
                for (const linha of dadosBarcode) {
                    const partes = linha.split(':');
                    resultados.push({
                        arquivo_pdf: nomePdf,
                        caminho: caminhoPdf,
                        pagina: paginaAtual,
                        tipo_barcode: partes[0].trim(),
                        dado: partes.slice(1).join(':').trim()
                    });
                }
            }
        }

    } catch (e) {
        // Loga erro detalhado no console do servidor
        console.error(`Falha ao processar ${nomePdf}:`, e.message);
        // Retorna um resultado de erro para ser processado no handler principal
        resultados.push({
            arquivo_pdf: nomePdf,
            caminho: caminhoPdf,
            pagina: 'ERRO',
            tipo_barcode: 'ERRO',
            dado: e.message
        });
    } finally {
        // Limpeza final de imagens temporárias
        await fse.emptyDir(TEMP_DIR);
    }

    return resultados;
}

// --- ROTAS DO EXPRESS ---

// Rota principal para servir o HTML
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Rota para processar os uploads
app.post('/upload-pdfs', upload.array('pdfs'), async (req, res) => {
    const files = req.files;
    if (!files || files.length === 0) {
        return res.status(400).json({ message: 'Nenhum arquivo PDF enviado.' });
    }

    let todasLinhas = [];
    
    // Processa cada arquivo enviado
    for (const file of files) {
        const resultadosPdf = await processarPdf(file.path);
        todasLinhas = todasLinhas.concat(resultadosPdf);
        // Remove o arquivo da pasta 'uploads' após o processamento
        await fse.remove(file.path);
    }
    
    // 3. Exportar para Excel
    const workbook = new exceljs.Workbook();
    const sheet = workbook.addWorksheet('Barcodes');

    sheet.columns = [
        { header: 'Arquivo PDF', key: 'arquivo_pdf', width: 30 },
        { header: 'Página', key: 'pagina', width: 10 },
        { header: 'Tipo Barcode', key: 'tipo_barcode', width: 20 },
        { header: 'Dado Extraído', key: 'dado', width: 50 },
        { header: 'Status / Erro', key: 'status', width: 50 } 
    ];

    // Mapear linhas e garantir que o status seja preenchido
    const linhasParaExcel = todasLinhas.map(linha => ({
        ...linha,
        status: linha.tipo_barcode === 'ERRO' ? 'FALHA DE PROCESSAMENTO' : 'SUCESSO'
    }));

    sheet.addRows(linhasParaExcel);
    
    const outputFilename = `barcodes_nf-${Date.now()}.xlsx`;
    const outputFilePath = path.join(OUTPUT_DIR, outputFilename);

    try {
        await workbook.xlsx.writeFile(outputFilePath);
        
        // Retorna sucesso com o nome do arquivo para o cliente
        return res.json({ 
            message: 'Arquivos processados com sucesso.', 
            filename: outputFilename,
            downloadUrl: `/download/${outputFilename}`
        });

    } catch (error) {
        console.error("Erro ao escrever arquivo Excel:", error);
        return res.status(500).json({ message: 'Erro ao gerar o arquivo Excel.' });
    }
});

// Rota de download para o arquivo Excel
app.get('/download/:filename', (req, res) => {
    const filePath = path.join(OUTPUT_DIR, req.params.filename);
    res.download(filePath, req.params.filename, (err) => {
        if (err) {
            console.error('Erro ao enviar download:', err);
            res.status(404).send('Arquivo não encontrado.');
        }
    });
});


// Inicia o servidor
app.listen(port, () => {
    console.log(`\nServidor rodando em http://localhost:${port}`);
    console.log("Acesse esta URL no seu navegador para importar os PDFs.");
});