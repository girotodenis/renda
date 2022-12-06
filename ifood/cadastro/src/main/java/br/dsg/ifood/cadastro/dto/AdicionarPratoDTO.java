package br.dsg.ifood.cadastro.dto;

import javax.validation.constraints.NotEmpty;
import javax.validation.constraints.NotNull;
import javax.validation.constraints.Size;

public class AdicionarPratoDTO {
	
	
	@NotEmpty
	@NotNull
	@Size(min=3, max=20, message = "Valor deve ser maior que 3 e menor que 20")
	public String nome;
	
	@NotEmpty
	@NotNull
	@Size(min=3, max=80, message = "Valor deve ser maior que 3 e menor que 80")
	public String descricao;
	
	@NotNull
	public Double preco;

}
