package br.dsg.ifood.cadastro.service;

import java.util.Optional;

import javax.enterprise.context.RequestScoped;
import javax.transaction.Transactional;
import javax.ws.rs.NotFoundException;

import br.dsg.ifood.cadastro.pojo.Restaurante;

@RequestScoped
public class RestauranteService {
	
	@Transactional
	public void adicionar(Restaurante dto) {
		
		dto.id = null;
		dto.persist();
	}
	
	@Transactional
	public void alterar(Restaurante dto) {
		
		Optional<Restaurante> restauranteOP = Restaurante.findByIdOptional(dto.id);
		Restaurante restaurante = restauranteOP.orElseThrow(NotFoundException::new);
		restaurante.nome = dto.nome; 
		restaurante.persist();
	}

	@Transactional
	public void deletar(Long idRestaurante) {
		
		Optional<Restaurante> restauranteOP = Restaurante.findByIdOptional(idRestaurante);
		Restaurante restaurante = restauranteOP.orElseThrow(NotFoundException::new);
		restaurante.delete();
	}

}
