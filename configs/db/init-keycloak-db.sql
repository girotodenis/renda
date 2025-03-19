CREATE USER onlyoffice WITH PASSWORD 'onlyoffice123';
CREATE USER keycloak WITH PASSWORD 'keycloak123';

-- Criar o esquema `onlyoffice` se ele não existir
DO
$$
BEGIN
    IF NOT EXISTS (SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'onlyoffice') THEN
        CREATE SCHEMA onlyoffice;
    END IF;
END
$$;

-- Conceder permissões ao usuário para o esquema `onlyoffice`
GRANT ALL PRIVILEGES ON SCHEMA onlyoffice TO onlyoffice;
-- Garantir que o proprietário do esquema é o usuário `onlyoffice`
ALTER SCHEMA onlyoffice OWNER TO onlyoffice;

-- Criar DATABASE keycloak
CREATE DATABASE keycloak;

-- Conceder permissões ao usuário `useradmin` e `keycloak` para acessar o banco de dados `keycloak`
GRANT ALL PRIVILEGES ON DATABASE dbdsg TO onlyoffice;
GRANT ALL PRIVILEGES ON DATABASE keycloak TO useradmin;
GRANT ALL PRIVILEGES ON DATABASE keycloak TO keycloak;

-- Trocar para o banco de dados keycloak
\connect keycloak

-- Criar o esquema `keycloak` se ele não existir
DO
$$
BEGIN
    IF NOT EXISTS (SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'keycloak') THEN
        CREATE SCHEMA keycloak;
    END IF;
END
$$;

-- Conceder permissões ao usuário para o esquema `keycloak`
GRANT ALL PRIVILEGES ON SCHEMA keycloak TO keycloak;
-- Garantir que o proprietário do esquema é o usuário `keycloak`
ALTER SCHEMA keycloak OWNER TO keycloak;