package br.dsg.ifood.cadastro.service;

import java.util.Optional;

import javax.enterprise.context.RequestScoped;
import javax.transaction.Transactional;
import javax.ws.rs.NotFoundException;

import br.dsg.ifood.cadastro.pojo.Prato;
import br.dsg.ifood.cadastro.pojo.Restaurante;

@RequestScoped
public class PratoService {
	
	@Transactional
	public void adicionar(Long idRestaurante, Prato dto) {
		
		Optional<Restaurante> restauranteOP = Restaurante.findByIdOptional(idRestaurante);
		Restaurante restaurante = restauranteOP.orElseThrow(NotFoundException::new);
		
		dto.id = null;
		dto.restaurante = restaurante;
		dto.persist();
	}
	
	@Transactional
	public void alterar( Prato dto) {
		
		
		Optional<Prato> pratoOP = Prato.findByIdOptional(dto.id);
		Prato prato = pratoOP.orElseThrow(NotFoundException::new);
		prato.nome = dto.nome; 
		prato.persist();
	}

	@Transactional
	public void deletar(Long idRestaurante) {
		
		Optional<Prato> pratoOP = Prato.findByIdOptional(idRestaurante);
		Prato prato = pratoOP.orElseThrow(NotFoundException::new);
		prato.delete();
	}

}
