package br.dsg.ifood.cadastro.dto;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;

import org.mapstruct.Mapper;
import org.mapstruct.Mapping;
import org.mapstruct.MappingTarget;

import br.dsg.ifood.cadastro.pojo.Restaurante;

@Mapper(componentModel = "cdi")
public interface RestauranteMapper {
	
	@Mapping(target = "dataCriacao",expression = "java(asString(dto.dataCriacao))", dateFormat = "dd/MM/yyyy HH:mm:ss")
//	@Mapping(target = "dataCriacao", ignore = true)
	RestauranteDTO toRestauranteDTO(Restaurante dto);
	
	@Mapping(target = "dataCriacao", ignore = true)
	@Mapping(target = "dataAtualizacao", ignore = true)
	@Mapping(target = "localizacao.id", ignore = true)
	Restaurante toRestaurante(AdicionarRestauranteDTO dto);
	
	void updateRestauranteFromDto(AlterarRestauranteDTO dto, @MappingTarget Restaurante restaurante);
	
	
	 default String asString(LocalDateTime data) {
	     return data.format(DateTimeFormatter.ofPattern("dd/MM/yyyy HH:mm:ss"));
	 }

}
