interface TextureFilePropertys {
  name: string;
  diffuseFile: string;
  normalFile: string;
  roughnessFile: string;
}

interface WorldTextures {
  pavement: TextureFilePropertys[];
  gras: TextureFilePropertys[];
  park: TextureFilePropertys[];
  sideWalk: TextureFilePropertys[];
}

interface BuildingTextures {
  roof: TextureFilePropertys[];
  wall: TextureFilePropertys[];
}

interface DistrictTextures {
  signatureHouses: BuildingTextures;
  houses: BuildingTextures;
  pavementTint: string;
}

export const worldTextures: Record <string, WorldTextures> = {

}

export const districtTexture: Record<string, DistrictTextures>  = {
  Adelsviertel: {
    signatureHouses: {
      roof: [
        {
        name: ``,
        diffuseFile: ``,
        normalFile: ``,
        roughnessFile: ``,
        }
      ],
      wall: [
        {
        name: ``,
        diffuseFile: ``,
        normalFile: ``,
        roughnessFile: ``,
        }
      ]
    },
    houses: {
      roof: [
        {
        name: ``,
        diffuseFile: ``,
        normalFile: ``,
        roughnessFile: "",
        }
      ],
      wall: [
        {
        name: "",
        diffuseFile: "",
        normalFile: "",
        roughnessFile: "",
        }
      ]
    },
    pavementTint: ""
  },
  Handelsviertel: {
    signatureHouses: {
      roof: [
        {
        name: "",
        diffuseFile: "",
        normalFile: "",
        roughnessFile: "",
        }
      ],
      wall: [
        {
        name: "",
        diffuseFile: "",
        normalFile: "",
        roughnessFile: "",
        }
      ]
    },
    houses: {
      roof: [
        {
        name: "",
        diffuseFile: "",
        normalFile: "",
        roughnessFile: "",
        }
      ],
      wall: [
        {
        name: "",
        diffuseFile: "",
        normalFile: "",
        roughnessFile: "",
        }
      ]
    },
    pavementTint: ""
  },
  Handwerksviertel: {
    signatureHouses: {
      roof: [
        {
        name: "",
        diffuseFile: "",
        normalFile: "",
        roughnessFile: "",
        }
      ],
      wall: [
        {
        name: "",
        diffuseFile: "",
        normalFile: "",
        roughnessFile: "",
        }
      ]
    },
    houses: {
      roof: [
        {
        name: "",
        diffuseFile: "",
        normalFile: "",
        roughnessFile: "",
        }
      ],
      wall: [
        {
        name: "",
        diffuseFile: "",
        normalFile: "",
        roughnessFile: "",
        }
      ]
    },
    pavementTint: ""
  },
  Bauernviertel: {
    signatureHouses: {
      roof: [
        {
        name: "",
        diffuseFile: "",
        normalFile: "",
        roughnessFile: "",
        }
      ],
      wall: [
        {
        name: "",
        diffuseFile: "",
        normalFile: "",
        roughnessFile: "",
        }
      ]
    },
    houses: {
      roof: [
        {
        name: "",
        diffuseFile: "",
        normalFile: "",
        roughnessFile: "",
        }
      ],
      wall: [
        {
        name: "",
        diffuseFile: "",
        normalFile: "",
        roughnessFile: "",
        }
      ]
    },
    pavementTint: ""
  },
}
