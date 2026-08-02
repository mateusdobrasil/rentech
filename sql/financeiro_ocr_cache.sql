-- Cache do valor lido via OCR (AWS Textract) nos comprovantes de
-- adiantamento/pagamento, para não precisar reler o mesmo PDF toda vez que a
-- tela Financeiro monta o lote ou o usuário aperta "OCR".
alter table folha_documentos_contabeis
  add column if not exists valor_ocr numeric(12,2),
  add column if not exists ocr_processado_em timestamptz;
