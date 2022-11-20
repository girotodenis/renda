package br.dsg.ifood.cadastro.service;

import java.util.Optional;

import javax.enterprise.context.RequestScoped;
import javax.inject.Inject;
import javax.transaction.Transactional;
import javax.ws.rs.NotFoundException;

import br.dsg.ifood.cadastro.dto.AdicionarPratoDTO;
import br.dsg.ifood.cadastro.dto.AlterarPratoDTO;
import br.dsg.ifood.cadastro.dto.PratoMapper;
import br.dsg.ifood.cadastro.pojo.Prato;
import br.dsg.ifood.cadastro.pojo.Restaurante;

@RequestScoped
public class PratoService {
	
	@Inject PratoMapper pratoMapper;
	
	@Transactional
	public void adicionar(Long idRestaurante, AdicionarPratoDTO dto) {
		
		Optional<Restaurante> restauranteOP = Restaurante.findByIdOptional(idRestaurante);
		Restaurante restaurante = restauranteOP.orElseThrow(NotFoundException::new);
		Prato prato = pratoMapper.toPrato(dto);
		prato.restaurante = restaurante;
		prato.persist();
	}
	
	@Transactional
	public void alterar(Long id, AlterarPratoDTO dto) {
		
		
		Optional<Prato> pratoOP = Prato.findByIdOptional(id);
		Prato prato = pratoOP.orElseThrow(NotFoundException::new);
		pratoMapper.updatePratoFromDto(dto, prato);
		prato.persist();
	}

	@Transactional
	public void deletar(Long idPrato) {
		
		Optional<Prato> pratoOP = Prato.findByIdOptional(idPrato);
		Prato prato = pratoOP.orElseThrow(NotFoundException::new);
		prato.delete();
	}

}
