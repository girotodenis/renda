package br.dsg.ifood.cadastro.service;

import java.util.Optional;

import javax.enterprise.context.RequestScoped;
import javax.inject.Inject;
import javax.transaction.Transactional;
import javax.ws.rs.NotFoundException;

import br.dsg.ifood.cadastro.dto.AdicionarRestauranteDTO;
import br.dsg.ifood.cadastro.dto.AlterarRestauranteDTO;
import br.dsg.ifood.cadastro.dto.RestauranteMapper;
import br.dsg.ifood.cadastro.pojo.Restaurante;

@RequestScoped
public class RestauranteService {
	
	@Inject
	RestauranteMapper restauranteMapper;
	
	@Transactional
	public void adicionar(AdicionarRestauranteDTO dto) {
		
		var restaurante = restauranteMapper.toRestaurante(dto);
		restaurante.persist();
	}
	
	@Transactional
	public void alterar(Long idRestaurante, AlterarRestauranteDTO dto) {
		
		Optional<Restaurante> restauranteOP = Restaurante.findByIdOptional(idRestaurante);
		Restaurante restaurante = restauranteOP.orElseThrow(NotFoundException::new);
		
        restauranteMapper.updateRestauranteFromDto(dto, restaurante);
		
        restaurante.persist();
	}

	@Transactional
	public void deletar(Long idRestaurante) {
		
		Optional<Restaurante> restauranteOP = Restaurante.findByIdOptional(idRestaurante);
		Restaurante restaurante = restauranteOP.orElseThrow(NotFoundException::new);
		restaurante.delete();
	}

}
