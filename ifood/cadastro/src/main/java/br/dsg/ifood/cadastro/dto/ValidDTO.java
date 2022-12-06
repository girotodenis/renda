package br.dsg.ifood.cadastro.dto;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

import javax.validation.Constraint;
import javax.validation.Payload;

@Target({ElementType.TYPE,ElementType.ANNOTATION_TYPE})
@Retention(RetentionPolicy.RUNTIME)
@Constraint(validatedBy = ValidDTOValidator.class)
@Documented
public @interface ValidDTO {
	
	String message() default "br.dsg.iffod.cadastro.dto.ValidDTO.message";
	
	Class<?>[] groups() default {};
	
	Class<? extends Payload>[] payload() default {};

}
