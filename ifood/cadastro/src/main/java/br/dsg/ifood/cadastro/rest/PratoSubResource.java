package br.dsg.ifood.cadastro.rest;

import java.util.List;
import java.util.stream.Collectors;

import javax.inject.Inject;
import javax.inject.Singleton;
import javax.transaction.Transactional;
import javax.ws.rs.DELETE;
import javax.ws.rs.GET;
import javax.ws.rs.POST;
import javax.ws.rs.PUT;
import javax.ws.rs.Path;
import javax.ws.rs.PathParam;
import javax.ws.rs.core.Response;
import javax.ws.rs.core.Response.Status;

import br.dsg.ifood.cadastro.dto.AdicionarPratoDTO;
import br.dsg.ifood.cadastro.dto.AlterarPratoDTO;
import br.dsg.ifood.cadastro.dto.PratoDTO;
import br.dsg.ifood.cadastro.dto.PratoMapper;
import br.dsg.ifood.cadastro.dto.RestauranteMapper;
import br.dsg.ifood.cadastro.pojo.Prato;
import br.dsg.ifood.cadastro.service.PratoService;

@Singleton
public class PratoSubResource {

	@Inject
	RestauranteMapper restauranteMapper;

	@Inject
	PratoService pratoService;

	@Inject
	PratoMapper pratoMapper;

	@GET
	public List<PratoDTO> todos(@PathParam("idRestaurante") Long idRestaurante) {
		List<Prato> pratos = Prato.find("restaurante.id", idRestaurante).list();
		return pratos.stream()
				.map(pratoMapper::toPratoDTO)
				.collect(Collectors.toList());
	}

	@POST
	@Transactional
	public Response cadastrar(@PathParam("idRestaurante") Long idRestaurante, AdicionarPratoDTO dto) {

		pratoService.adicionar(idRestaurante, dto);
		return Response.status(Status.CREATED).build();
	}

	@PUT
	@Path("{id}")
	@Transactional
	public Response alterar(@PathParam("id") Long id, AlterarPratoDTO dto) {

		pratoService.alterar(id, dto);
		return Response.status(Status.NO_CONTENT).build();
	}

	@DELETE
	@Path("{id}")
	@Transactional
	public Response deletar(@PathParam("id") Long id) {

		pratoService.deletar(id);
		return Response.status(Status.NO_CONTENT).build();
	}

}