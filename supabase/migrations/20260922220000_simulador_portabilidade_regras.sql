-- Migration para tabela de Regras Individuais por IF e Convênio no Simulador de Portabilidade

CREATE TABLE IF NOT EXISTS regras_portabilidade_ifs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES financial_institutions(id) ON DELETE CASCADE,
  convenio_id UUID REFERENCES convenios(id) ON DELETE SET NULL,
  convenio_codigo TEXT NOT NULL DEFAULT 'INSS',
  enabled BOOLEAN NOT NULL DEFAULT true,
  coeficiente_novo_medio NUMERIC(10, 6) DEFAULT NULL,
  port_coeff NUMERIC(10, 6) DEFAULT NULL,
  block_loas BOOLEAN NOT NULL DEFAULT false,
  loas_species TEXT DEFAULT '87,88',
  loas_reason TEXT DEFAULT 'Não porta LOAS',
  block_representative BOOLEAN NOT NULL DEFAULT false,
  representative_reason TEXT DEFAULT 'Não faz representante',
  entry NUMERIC(5, 2) DEFAULT NULL,
  refi_min NUMERIC(5, 2) DEFAULT NULL,
  refi_max NUMERIC(5, 2) DEFAULT NULL,
  age_min INT DEFAULT NULL,
  age_max_years INT DEFAULT NULL,
  age_max_months INT DEFAULT NULL,
  end_age_years INT DEFAULT NULL,
  end_age_months INT DEFAULT NULL,
  term INT NOT NULL DEFAULT 108,
  min_installment NUMERIC(12, 2) DEFAULT NULL,
  min_debt NUMERIC(12, 2) DEFAULT NULL,
  min_financed NUMERIC(12, 2) DEFAULT NULL,
  min_release NUMERIC(12, 2) DEFAULT NULL,
  min_release_mode TEXT DEFAULT 'fixed',
  min_release_percent NUMERIC(5, 2) DEFAULT NULL,
  default_paid INT DEFAULT NULL,
  network_paid INT DEFAULT NULL,
  blocked TEXT[] DEFAULT '{}',
  paid JSONB DEFAULT '{}'::jsonb,
  special TEXT[] DEFAULT '{}',
  under12 TEXT[] DEFAULT '{}',
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_regras_portabilidade_inst_convenio UNIQUE (institution_id, convenio_codigo)
);

CREATE TABLE IF NOT EXISTS regras_portabilidade_globais (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  default_port_coeff NUMERIC(10, 6) NOT NULL DEFAULT 0.02251,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Habilitar RLS
ALTER TABLE regras_portabilidade_ifs ENABLE ROW LEVEL SECURITY;
ALTER TABLE regras_portabilidade_globais ENABLE ROW LEVEL SECURITY;

-- Politicas RLS
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'regras_portabilidade_ifs' AND policyname = 'Leitura de regras de portabilidade'
  ) THEN
    CREATE POLICY "Leitura de regras de portabilidade" ON regras_portabilidade_ifs FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'regras_portabilidade_ifs' AND policyname = 'Escrita de regras de portabilidade'
  ) THEN
    CREATE POLICY "Escrita de regras de portabilidade" ON regras_portabilidade_ifs FOR ALL USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'regras_portabilidade_globais' AND policyname = 'Leitura de coeficientes globais'
  ) THEN
    CREATE POLICY "Leitura de coeficientes globais" ON regras_portabilidade_globais FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'regras_portabilidade_globais' AND policyname = 'Escrita de coeficientes globais'
  ) THEN
    CREATE POLICY "Escrita de coeficientes globais" ON regras_portabilidade_globais FOR ALL USING (true);
  END IF;
END $$;
