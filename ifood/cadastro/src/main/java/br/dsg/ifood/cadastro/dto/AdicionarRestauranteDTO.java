package br.dsg.ifood.cadastro.dto;

import javax.validation.ConstraintValidatorContext;
import javax.validation.constraints.NotEmpty;
import javax.validation.constraints.NotNull;
import javax.validation.constraints.Pattern;
import javax.validation.constraints.Size;

import br.dsg.ifood.cadastro.pojo.Restaurante;

@ValidDTO
public class AdicionarRestauranteDTO implements DTO{
	
	
	@Pattern(regexp = "[0-9]{2}\\.[0-9]{3}\\.[0-9]{3}\\/[0-9]{4}\\-[0-9]{2}")
	@NotNull
	public String cnpj;
	
	@NotEmpty
	@NotNull
	@Size(min=3, max=20, message = "Valor deve ser maior que 3 e menor que 20")
	public String nome;
	
	public LocalizacaoDTO localizacao;

	@Override
	public boolean isValid(ConstraintValidatorContext context) {
		context.disableDefaultConstraintViolation();
		if(Restaurante.find("cnpj", cnpj).count()>0) {
			context.buildConstraintViolationWithTemplate("CNPJ já cadastrado")
			.addPropertyNode("cnpj")
			.addConstraintViolation();
			return false;
		}
		return true;
	} 
	
	
	
}
