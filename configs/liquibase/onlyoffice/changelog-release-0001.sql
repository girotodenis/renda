-- liquibase formatted sql


-- changeset releasetcreate:1
-- Criação da tabela de versão no esquema onlyoffice
CREATE TABLE onlyoffice.tb_versao (
    versao VARCHAR(50) NOT NULL,
    id_modificacao VARCHAR(50) NOT NULL,
    descricao VARCHAR(1000),
    PRIMARY KEY (versao, id_modificacao)
);
