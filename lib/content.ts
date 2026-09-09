export const company = {
  name: "Alfalight Locadora",
  phoneDisplay: "(11) 99852-7420",
  phoneHref: "tel:+5511998527420",
  whatsappNumber: "5511998527420",
  whatsappDisplay: "(11) 99852-7420",
  whatsappHref:
    "https://wa.me/5511998527420?text=Ol%C3%A1%2C%20vim%20pelo%20site%20e%20gostaria%20de%20um%20or%C3%A7amento%20de%20loca%C3%A7%C3%A3o%20de%20ar%20condicionado.",
  email: "atendimento@alfalight.com.br",
};

export function buildWhatsappLink(message: string) {
  return `https://wa.me/${company.whatsappNumber}?text=${encodeURIComponent(message)}`;
}
