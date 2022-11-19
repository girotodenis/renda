package br.dsg.ifood.cadastro.dto;

import org.mapstruct.Mapper;
import org.mapstruct.MappingTarget;

import br.dsg.ifood.cadastro.pojo.Restaurante;

@Mapper(componentModel = "cdi")
public interface RestauranteMapper {
	
	RestauranteDTO toRestauranteDTO(Restaurante dto);
	
	Restaurante toRestaurante(AdicionarRestauranteDTO dto);
	
	void updateRestauranteFromDto(AlterarRestauranteDTO dto, @MappingTarget Restaurante restaurante);

}
