# 🚌 Piccolotur – Barcode PDF Importer

Sistema automatizado para extração de códigos de barras a partir de Notas Fiscais em PDF e geração de relatório em Excel.  
Desenvolvido para padronizar e acelerar processos internos da Piccolotur.

---

## 🎯 Objetivo do Projeto

Eliminar a leitura manual de códigos de barras em Notas Fiscais PDF, garantindo:

- Confiabilidade na extração
- Padronização do processo
- Redução de erros humanos
- Facilidade de uso para colaboradores não técnicos

---

## ⚠️ Arquitetura e Aviso Importante de Ambiente

Este projeto **depende de ferramentas nativas de sistema** para funcionar corretamente:

- **Poppler (`pdftoppm`)** – Conversão de PDF vetorial para imagem
- **ZBar (`zbarimg`)** – Decodificação de códigos de barras

Essas ferramentas **não são bibliotecas JavaScript**, e sim binários de sistema operacional.

### ✅ Uso de Docker (Altamente Recomendado)

O uso do Docker **não é opcional em ambiente corporativo**.

Motivos:
- Elimina problemas de PATH e variáveis de ambiente
- Evita erros de DLL no Windows
- Garante comportamento idêntico entre DEV / TEST / PROD
- Simplifica suporte e manutenção

👉 **Sem Docker, o projeto exigirá configuração manual de Poppler e ZBar no sistema operacional.**

---

## 🧱 Tecnologias Utilizadas

### Backend
- **Node.js (v20+)**
- **Express.js**

### Orquestração de Processos
- `child_process` para execução direta de binários nativos

### Processamento de Documentos (via Docker)
- **Poppler (`pdftoppm`)**
  - Conversão de PDFs em imagens JPEG
  - Resolução padrão: **300 DPI** (ideal para NF-e)
- **ZBar (`zbarimg`)**
  - Leitura de CODE128, EAN, QR Code e similares

### Frontend
- HTML5 / CSS3
- Interface simples para upload de arquivos

### Relatórios
- **ExcelJS** para geração do arquivo `.xlsx`

---

## 📋 Funcionalidades

- Upload de múltiplos PDFs via navegador
- Preservação do nome original da Nota Fiscal
- Processamento de PDFs digitais e escaneados
- Extração automática dos códigos de barras
- Geração e download do relatório Excel

---

## 🛠️ Como Executar o Projeto (Docker)

### Pré-requisito
- Docker instalado na máquina

---

### 1️⃣ Build da Imagem

Na raiz do projeto:

```bash
docker build -t piccolotur-barcode-importer .

```
---

### 2️⃣ Execução do Container

```bash
docker run -d \
  --name barcode-service \
  -p 3000:3000 \
  piccolotur-barcode-importer

```
---

### 3️⃣ Acesso ao Sistema

Abra o navegador e acesse:

```bash

http://localhost:3000

```
---


### 📁 Estrutura do Projeto

```
├── public/
│   ├── css/
│   │   └── styles.css
│   ├── img/
│   │   └── piccolotur_image.png
│   └── index.html        # Interface de upload
│
├── temp_images/          # Imagens temporárias geradas pelo Poppler
├── server.js             # Servidor Express e lógica principal
├── Dockerfile            # Instala Node, Poppler e ZBar
├── .dockerignore
└── package.json
```


### ⚙️ Fluxo de Processamento Interno

O usuário envia o PDF via interface web

O arquivo é salvo mantendo o nome original

O Poppler converte cada página em imagem (JPEG – 300 DPI)

O ZBar varre as imagens e extrai os códigos de barras

Os dados são consolidados em um arquivo Excel

Os arquivos temporários são removidos automaticamente
