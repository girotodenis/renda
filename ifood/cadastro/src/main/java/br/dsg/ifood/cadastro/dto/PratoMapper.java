package br.dsg.ifood.cadastro.dto;

import org.mapstruct.Mapper;
import org.mapstruct.Mapping;
import org.mapstruct.MappingTarget;

import br.dsg.ifood.cadastro.pojo.Prato;

@Mapper(componentModel = "cdi")
public interface PratoMapper {
	
	PratoDTO toPratoDTO(Prato dto);
	
	@Mapping(target = "id", ignore = true)
	@Mapping(target = "restaurante", ignore = true)
	Prato toPrato(AdicionarPratoDTO dto);
	
	void updatePratoFromDto(AlterarPratoDTO dto, @MappingTarget Prato prato);

}
