package br.dsg.ifood.cadastro.pojo;

import java.time.LocalDate;

import javax.persistence.CascadeType;
import javax.persistence.Entity;
import javax.persistence.GeneratedValue;
import javax.persistence.GenerationType;
import javax.persistence.Id;
import javax.persistence.OneToOne;
import javax.persistence.Table;

import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import io.quarkus.hibernate.orm.panache.PanacheEntityBase;

@Entity
@Table(name = "tb_restaurante")
public class Restaurante extends PanacheEntityBase {
	
	@Id
	@GeneratedValue(strategy = GenerationType.IDENTITY)
	public Long id;
	
	public String proprietario;
	
	public String cnpj;
	
	public String nome;
	
	@OneToOne(cascade = CascadeType.ALL)
	public Localizacao localizacao; 
	
	@CreationTimestamp
	public LocalDate dataCriacao;
	
	@UpdateTimestamp
	public LocalDate dataAtualizacao;
	
	

}
