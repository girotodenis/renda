package br.dsg.ifood.cadastro.rest;

import java.util.List;

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

import br.dsg.ifood.cadastro.pojo.Prato;
import br.dsg.ifood.cadastro.service.PratoService;

@Singleton
public class PratoSubResource {
	
	@Inject
	PratoService pratoService;
	
	@GET
	public List<Prato> todos(@PathParam("idRestaurante")Long idRestaurante) {
		
		return Prato.find("restaurante.id", idRestaurante).list();
	}

	@POST
	@Transactional
	public Response cadastrar(@PathParam("idRestaurante")Long idRestaurante, Prato dto) {
		
		pratoService.adicionar(idRestaurante, dto);
		return Response.status(Status.CREATED).build();
	}
	
	@PUT
	@Path("{id}")
	@Transactional
	public Response alterar(@PathParam("id")Long id,  Prato dto) {
		
		pratoService.alterar(dto);
		return Response.status(Status.OK).build();
	}
	
	@DELETE
	@Path("{id}")
	@Transactional
	public Response deletar(@PathParam("id")Long id) {
		
		pratoService.deletar(id);
		return Response.status(Status.OK).build();
	}

}