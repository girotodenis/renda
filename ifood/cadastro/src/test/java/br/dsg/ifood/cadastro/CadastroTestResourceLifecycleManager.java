package br.dsg.ifood.cadastro;

import java.util.HashMap;
import java.util.Map;

import org.testcontainers.containers.PostgreSQLContainer;

import io.quarkus.test.common.QuarkusTestResourceLifecycleManager;

public class CadastroTestResourceLifecycleManager implements QuarkusTestResourceLifecycleManager{
	
	public static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:15");

	@Override
	public Map<String, String> start() {
		POSTGRES.start();
		HashMap<String, String> hashMap = new HashMap<>();
		
		hashMap.put("quarkus.datasource.jdbc.url", POSTGRES.getJdbcUrl());
		hashMap.put("quarkus.datasource.username", POSTGRES.getUsername());
		hashMap.put("quarkus.datasource.password", POSTGRES.getPassword());
		
		return hashMap;
	}

	@Override
	public void stop() {
		if(POSTGRES.isRunning()) {
			POSTGRES.start();
		}
		
	}

}
