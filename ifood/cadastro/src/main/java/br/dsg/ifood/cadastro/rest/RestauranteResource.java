package br.dsg.ifood.cadastro.rest;

import java.util.List;

import javax.inject.Inject;
import javax.ws.rs.Consumes;
import javax.ws.rs.DELETE;
import javax.ws.rs.GET;
import javax.ws.rs.POST;
import javax.ws.rs.PUT;
import javax.ws.rs.Path;
import javax.ws.rs.PathParam;
import javax.ws.rs.Produces;
import javax.ws.rs.core.MediaType;
import javax.ws.rs.core.Response;
import javax.ws.rs.core.Response.Status;

import br.dsg.ifood.cadastro.pojo.Restaurante;
import br.dsg.ifood.cadastro.repository.RestauranteRepository;
import br.dsg.ifood.cadastro.service.RestauranteService;

@Path("/restaurantes")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class RestauranteResource {
	
	@Inject
	PratoSubResource pratoSubResource;
	
	@Inject
	RestauranteRepository restauranteRepository;
	
	@Inject
	RestauranteService restauranteService;
	
	@GET
	public List<Restaurante> todos() {
		
		return restauranteRepository.findAll().list();
	}

	@POST
	public Response cadastrar(Restaurante dto) {
		
		restauranteService.adicionar( dto );
		return Response.status(Status.CREATED).build();
	}
	
	@PUT
	@Path("{idRestaurante}")
	public Response alterar(@PathParam("idRestaurante")Long idRestaurante, Restaurante dto) {
		
		dto.id = idRestaurante;
		restauranteService.adicionar( dto );
		return Response.status(Status.OK).build();
	}
	
	@DELETE
	@Path("{idRestaurante}")
	public Response deletar(@PathParam("idRestaurante")Long idRestaurante) {
		
		restauranteService.deletar( idRestaurante );
		return Response.status(Status.OK).build();
	}
	
	@Path("{idRestaurante}/pratos")
	public PratoSubResource acessarPratos() {
		
		return pratoSubResource;
	}
	
}