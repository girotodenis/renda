package br.dsg.ifood.cadastro.dto;

import org.mapstruct.Mapper;
import org.mapstruct.Mapping;
import org.mapstruct.MappingTarget;

import br.dsg.ifood.cadastro.pojo.Restaurante;

@Mapper(componentModel = "cdi")
public interface RestauranteMapper {
	
	@Mapping(target = "dataCriacao", dateFormat = "dd/MM/yyyy HH:mm:ss")
	RestauranteDTO toRestauranteDTO(Restaurante dto);
	
	@Mapping(target = "dataCriacao", ignore = true)
	@Mapping(target = "dataAtualizacao", ignore = true)
	@Mapping(target = "localizacao.id", ignore = true)
	Restaurante toRestaurante(AdicionarRestauranteDTO dto);
	
	void updateRestauranteFromDto(AlterarRestauranteDTO dto, @MappingTarget Restaurante restaurante);

}
