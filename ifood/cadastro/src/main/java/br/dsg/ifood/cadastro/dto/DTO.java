package br.dsg.ifood.cadastro.dto;

import javax.validation.ConstraintValidatorContext;

public interface DTO {
	
	default boolean isValid(ConstraintValidatorContext constraintValidatorContext) {
		return true;
	}

}
