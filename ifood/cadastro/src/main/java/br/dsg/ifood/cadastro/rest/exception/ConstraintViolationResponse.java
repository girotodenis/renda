package br.dsg.ifood.cadastro.rest.exception;

import java.util.ArrayList;
import java.util.List;

import javax.validation.ConstraintViolationException;

public class ConstraintViolationResponse {
	
	private final List<ConstraintViolationImpl> violacoes = new ArrayList<>();
	
	private ConstraintViolationResponse(ConstraintViolationException exception) {
		exception.getConstraintViolations().forEach( v-> violacoes.add(ConstraintViolationImpl.of(v)) );
	}
	
	public static ConstraintViolationResponse of(ConstraintViolationException exception) {
		return new ConstraintViolationResponse(exception);
	}

	public List<ConstraintViolationImpl> getViolacoes() {
		return violacoes;
	}
	

}
