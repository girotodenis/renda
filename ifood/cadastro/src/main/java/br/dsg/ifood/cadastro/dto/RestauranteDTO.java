package br.dsg.ifood.cadastro.dto;

import java.time.LocalDate;

public class RestauranteDTO {
	
	public Long  id;
	
	public String proprietario;
	
	public String cnpj;
	
	public String nome;
	
	public LocalizacaoDTO localizacao; 
	
	public LocalDate dataAtualizacao;
	
}
