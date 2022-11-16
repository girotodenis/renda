package br.dsg.ifood.cadastro.repository;

import java.util.List;

import javax.enterprise.context.ApplicationScoped;

import br.dsg.ifood.cadastro.pojo.Restaurante;
import io.quarkus.hibernate.orm.panache.PanacheQuery;
import io.quarkus.hibernate.orm.panache.PanacheRepository;

@ApplicationScoped
public class RestauranteRepository implements PanacheRepository<Restaurante>{
	
	public List<Restaurante> listaByPage(int page, int size){
		
		PanacheQuery<Restaurante> lista = findAll();
		return lista.page(page, size).list();
	}

}
